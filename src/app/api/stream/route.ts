import { NextRequest } from 'next/server';
import youtubeDl from 'youtube-dl-exec';
import { Platform } from '@/types/media';
import { getEngineType } from '@/lib/adapters';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getFormatInfo, storeFormatInfo, CachedFormat, deleteFormatInfo } from '@/lib/format-cache';
import {
  verifyStreamMetadata,
  getRemoteFileSize,
  downloadChunkedRange,
  mergeAudioVideoLocally,
  transcodeAudioToMp3Locally,
  transcodeAudioLocally,
} from '@/lib/fast-downloader';
import {
  setRenderProgress,
  getRenderProgress,
  deleteRenderProgress,
  createRenderSession,
  cancelRenderSession,
  endRenderSession,
} from '@/lib/render-progress';
import { formatDuration, parseDurationToSeconds } from '@/lib/url-parser';
import { getClientIp, getClientCountry } from '@/lib/security/rate-limit';
import { checkIpAccess, recordIpActivity, isBotUserAgent } from '@/lib/security/abuse-protection';
import { logRequest, incrementActiveTasks, decrementActiveTasks } from '@/lib/security/telemetry';

function getFFmpegBinaryPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const installer = require('@ffmpeg-installer/ffmpeg');
    if (installer && installer.path && fs.existsSync(installer.path)) {
      return installer.path;
    }
  } catch {}
  const localBin = path.join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', 'ffmpeg.exe');
  if (fs.existsSync(localBin)) return localBin;
  return 'ffmpeg';
}

function buildHeaderString(headersObj?: Record<string, string>): string {
  if (!headersObj || typeof headersObj !== 'object') return '';
  let s = '';
  for (const [k, v] of Object.entries(headersObj)) {
    // Avoid sending referer that mismatches signed googlevideo URLs
    if (k.toLowerCase() === 'referer') continue;
    s += `${k}: ${v}\r\n`;
  }
  return s;
}

async function resolveYouTubeFormats(
  decodedUrl: string,
  cookieFile: string,
  hasCookies: boolean,
  compositeSignal?: AbortSignal
): Promise<CachedFormat[]> {
  const cached = getFormatInfo(decodedUrl);
  if (cached && cached.length > 0) return cached;

  const attempts = [
    ...(hasCookies ? [{ cookies: cookieFile }] : []),
    ...(hasCookies ? [{ extractorArgs: 'youtube:player_client=web', cookies: cookieFile }] : []),
    {},
    { extractorArgs: 'youtube:player_client=web' },
    ...(hasCookies ? [{ extractorArgs: 'youtube:player_client=tv_embedded,web', cookies: cookieFile }] : []),
    { extractorArgs: 'youtube:player_client=tv_embedded,web' },
  ];

  for (const attempt of attempts) {
    if (compositeSignal?.aborted) break;
    try {
      const info = (await youtubeDl(decodedUrl, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        ...attempt,
      })) as Record<string, unknown>;

      if (info && Array.isArray(info.formats) && info.formats.length > 0) {
        storeFormatInfo(decodedUrl, info.formats);
        const resolved = getFormatInfo(decodedUrl);
        if (resolved && resolved.length > 0) return resolved;
      }
    } catch {
      continue;
    }
  }

  return [];
}

// ─── GET /api/stream ───────────────────────────────────────────────────────
//
// Query params:
//   url          — encoded original platform URL (yt-dlp re-extraction)
//                  OR a pre-resolved CDN/Cobalt tunnel URL
//   filename     — desired filename (without extension)
//   platform     — 'youtube' | 'tiktok' | 'instagram' | 'facebook'
//   audioOnly    — 'true' → extract M4A audio stream (no ffmpeg transcoding)
//   isCobaltUrl  — 'true' → url is a Cobalt tunnel URL, skip yt-dlp resolution
//
// ── SECURITY HARDENING (Pillar 3) ──────────────────────────────────────────
//
// Problem: Dangling connections burn server RAM + bandwidth.
//
// Two failure modes addressed:
//   A) SLOW UPSTREAM: CDN takes >15s to send response headers
//      → Composite AbortController aborts the fetch after CONNECTION_TIMEOUT_MS
//
//   B) CLIENT DISCONNECT: User closes tab / browser mid-download
//      → req.signal (Next.js built-in) fires → composite controller aborts
//      → upstream fetch body is cancelled immediately
//      → server stops reading and discards buffered data
//
// Implementation: a single `createCompositeSignal()` utility that fires when
// EITHER the 15s timeout OR req.signal fires, whichever comes first.
// After headers are received, clearTimeout() removes the connection timeout
// while keeping client-disconnect monitoring active for the body stream.
//
// ── ZERO DISK WRITES ────────────────────────────────────────────────────────
// ── RANGE HEADER FORWARDING (pause/resume) ───────────────────────────────
// (See previous revision notes — both already implemented below.)

// ─── Constants ─────────────────────────────────────────────────────────────

/**
 * Maximum seconds to wait for upstream CDN to return response headers.
 * After this, the connection is aborted — regardless of body streaming progress.
 * Body streaming itself has no hard timeout (it runs as long as the client
 * is actively downloading).
 */
const CONNECTION_TIMEOUT_MS = 60_000; // 60 seconds

// yt-dlp format strings — YouTube must be progressive only (no DASH / no ffmpeg)
const YTDLP_FORMAT_MAP: Record<string, string> = {
  youtube:
    '18/22/best[ext=mp4][height<=720][vcodec!=none][acodec!=none]' +
    '/best[ext=mp4][height<=480][vcodec!=none][acodec!=none]' +
    '/best[ext=mp4][vcodec!=none][acodec!=none]' +
    '/best[vcodec!=none][acodec!=none]' +
    '/best',
  youtube_audio: 'bestaudio[ext=m4a]/bestaudio[ext=aac]/bestaudio/140/best',
  tiktok: 'bestvideo[vcodec!=none]+bestaudio/best',
  instagram: 'best[ext=mp4]/best',
  facebook: 'best[ext=mp4]/best',
  audio: 'bestaudio[ext=m4a]/bestaudio[ext=aac]/bestaudio',
};

const PLATFORM_REFERERS: Partial<Record<Platform, string>> = {
  youtube: 'https://www.youtube.com/',
  tiktok: 'https://www.tiktok.com/',
  instagram: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Composite AbortSignal Helper ──────────────────────────────────────────

/**
 * Creates an AbortController whose signal fires when EITHER:
 *   - `externalSignal` is aborted (e.g. client disconnect via req.signal), OR
 *   - the internal timeout elapses.
 *
 * This replaces `AbortSignal.any()` which requires Node 20+ / modern engines.
 *
 * Correct usage pattern:
 * ```typescript
 * const { signal, clearTimeout: clear } = createCompositeSignal(req.signal, 15_000);
 * try {
 *   const upstream = await fetch(url, { signal });
 *   clear(); // ← MUST call this after headers arrive to cancel timeout
 *   // Body streaming continues; externalSignal still watched.
 * } catch { ... } finally { clear(); }
 * ```
 *
 * @param externalSignal - AbortSignal to proxy (client disconnect, etc.)
 * @param timeoutMs - Maximum milliseconds before aborting.
 */
function createCompositeSignal(
  externalSignal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; clearConnectionTimeout: () => void } {
  const controller = new AbortController();

  // ── Abort if external signal already fired ─────────────────────────────
  if (externalSignal.aborted) {
    controller.abort(externalSignal.reason ?? new Error('External signal already aborted'));
    return { signal: controller.signal, clearConnectionTimeout: () => {} };
  }

  // ── Timeout leg ────────────────────────────────────────────────────────
  const timeoutId = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(
        new DOMException(
          `Upstream CDN did not respond within ${timeoutMs / 1000} seconds.`,
          'TimeoutError',
        ),
      );
    }
  }, timeoutMs);

  // ── External signal leg ────────────────────────────────────────────────
  const onExternalAbort = (): void => {
    if (!controller.signal.aborted) {
      controller.abort(externalSignal.reason ?? new Error('Client disconnected'));
    }
  };
  externalSignal.addEventListener('abort', onExternalAbort, { once: true });

  // ── Cleanup: cancel timeout + remove listener ──────────────────────────
  // Called after upstream headers arrive (body can take unlimited time).
  // The external-signal listener is kept active so client disconnects still
  // propagate to the body streaming.
  const clearConnectionTimeout = (): void => {
    clearTimeout(timeoutId);
    // NOTE: we deliberately do NOT remove the externalSignal listener here
    // because we still want client disconnects to abort the body stream.
  };

  return { signal: controller.signal, clearConnectionTimeout };
}

// ─── Background Async Render Task ──────────────────────────────────────────

async function executeBackgroundRender({
  decodedUrl,
  platform,
  formatId,
  ext,
  filename,
  renderId,
  bitrate,
  duration,
  audioOnly,
  clientIp,
}: {
  decodedUrl: string;
  platform: Platform | '';
  formatId?: string | null;
  ext: string;
  filename: string;
  renderId: string;
  bitrate?: string | null;
  duration?: number | null;
  audioOnly?: boolean;
  clientIp?: string;
}): Promise<void> {
  // ── Global try/catch: guarantee ANY unhandled error transitions to stage: 'error' ──
  // Without this, silent crashes leave progress stuck at 1% forever.
  incrementActiveTasks();
  const { signal, addTempFile, isAborted } = createRenderSession(renderId, clientIp);
  try {
  const cookieFilenames: Record<string, string> = {
    youtube: '.youtube-cookies.txt',
    instagram: '.instagram-cookies.txt',
    tiktok: '.tiktok-cookies.txt',
  };
  const platformCookie = cookieFilenames[platform as string] ?? '.youtube-cookies.txt';
  const cookieFile = path.join(process.cwd(), 'data', platformCookie);
  const hasCookies = fs.existsSync(cookieFile);

  const ffmpegPath = getFFmpegBinaryPath();
  const tempDir = path.join(process.cwd(), 'data', 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // ── BRANCH 1: Universal Audio Download & Conversion (MP3, M4A, AAC, WEBM Audio) ──
  const isAudioExt = ext === 'mp3' || ext === 'm4a' || ext === 'aac' || (ext === 'webm' && Boolean(audioOnly));
  if (isAudioExt) {
    let sourceAudioUrl = decodedUrl;
    let sourceHeaders: Record<string, string> | undefined;

    if (platform === 'youtube') {
      // Update progress so client sees we're actively working
      setRenderProgress(renderId, {
        stage: 'downloading',
        percent: 2,
        downloadedBytes: 0,
        totalBytes: 0,
        message: 'Mengambil informasi audio dari YouTube…',
      });

      // Race yt-dlp resolution against a 90-second safety timeout
      const formatResult = await Promise.race([
        resolveYouTubeFormats(decodedUrl, cookieFile, hasCookies),
        new Promise<CachedFormat[]>((_, reject) =>
          setTimeout(() => reject(new Error('Format resolution timeout (90s)')), 90_000)
        ),
      ]).catch((err) => {
        console.error('[executeBackgroundRender] YouTube format resolution failed:', err);
        return [] as CachedFormat[];
      });
      const formats = formatResult;
      const audioFormats = formats.filter(
        (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url
      );

      // Select best audio source based on requested format:
      // Select best audio source based on requested format:
      // If user wants M4A / AAC / MP3, prefer native M4A/AAC source (format 140, 44.1kHz stereo)
      // If user wants WEBM / Opus, prefer Opus source (format 251, 48kHz)
      let bestAudio: CachedFormat | undefined;
      if (ext === 'm4a' || ext === 'aac' || ext === 'mp3') {
        bestAudio = audioFormats.find((f) => f.ext === 'm4a' || f.acodec?.includes('mp4a'));
      } else if (ext === 'webm') {
        bestAudio = audioFormats.find((f) => f.ext === 'webm' || f.acodec?.includes('opus'));
      }
      if (!bestAudio) {
        audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
        bestAudio = audioFormats[0];
      }

      if (!bestAudio || !bestAudio.url) {
        setRenderProgress(renderId, {
          stage: 'error',
          percent: 0,
          message: 'Format audio YouTube tidak tersedia untuk video ini.',
        });
        return;
      }
      sourceAudioUrl = bestAudio.url;
      sourceHeaders = bestAudio.http_headers;
    }

    const meta = await verifyStreamMetadata(sourceAudioUrl, sourceHeaders);
    if (!meta.success || meta.size <= 0) {
      if (platform === 'youtube' && meta.statusCode === 403) {
        deleteFormatInfo(decodedUrl);
      }
      setRenderProgress(renderId, {
        stage: 'error',
        percent: 0,
        message: meta.error || 'Gagal memverifikasi metadata audio dari server sumber.',
      });
      return;
    }

    const audioSize = meta.size;
    setRenderProgress(renderId, {
      stage: 'downloading',
      percent: 5,
      downloadedBytes: 0,
      totalBytes: audioSize,
      message: 'Menyiapkan audio kecepatan penuh (multi-koneksi)…',
    });

    const tempAudioPath = path.join(tempDir, `audio_${sessionId}.tmp`);
    const tempAudioOutPath = path.join(tempDir, `out_${sessionId}.${ext}`);
    addTempFile(tempAudioPath);
    addTempFile(tempAudioOutPath);

    try {
      if (isAborted()) return;

      // Phase 1: Download audio source chunks (maps to 0% - 50% overall progress)
      await downloadChunkedRange(sourceAudioUrl, tempAudioPath, audioSize, {
        headers: sourceHeaders,
        signal,
        concurrency: 6,
        onProgress: (bytes, total) => {
          const dlPct = Math.min(50, Math.max(5, Math.round((bytes / total) * 50)));
          const isMb = total >= 1024 * 1024;
          const strBytes = isMb ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
          const strTotal = isMb ? `${(total / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(total / 1024)} KB`;
          setRenderProgress(renderId, {
            stage: 'downloading',
            percent: dlPct,
            downloadedBytes: bytes,
            totalBytes: total,
            message: `Mengunduh audio: ${dlPct * 2}% (${strBytes} / ${strTotal})`,
          });
        },
      });

      if (isAborted()) return;

      const extUpper = ext.toUpperCase();
      setRenderProgress(renderId, {
        stage: 'merging',
        percent: 50,
        message: ext === 'mp3' ? `Mengonversi audio ke MP3…` : `Menyiapkan format audio ${extUpper} instan…`,
      });

      const durSec = duration && duration > 0 ? duration : 0;
      await transcodeAudioLocally(
        tempAudioPath,
        tempAudioOutPath,
        ext,
        bitrate || (ext === 'mp3' ? '320k' : 'original'),
        ffmpegPath,
        (p) => {
          if (!renderId) return;
          const convPct = durSec > 0 ? Math.min(100, Math.round((p.seconds / durSec) * 100)) : 50;
          const overallPct = Math.min(99, Math.round(50 + (convPct * 0.49)));
          const durStr = durSec > 0 ? formatDuration(durSec) : '';
          const msg = ext === 'mp3'
            ? (durStr
                ? `Mengonversi ke MP3: ${p.timeStr} / ${durStr} (${convPct}%) • Kecepatan ${p.speed}x`
                : `Mengonversi ke MP3: ${p.timeStr} (${convPct}%) • Kecepatan ${p.speed}x`)
            : `Menyiapkan format ${extUpper} instan: ${p.timeStr}`;
          setRenderProgress(renderId, {
            stage: 'merging',
            percent: overallPct,
            message: msg,
          });
        },
        signal,
        durSec
      );

      if (isAborted()) return;

      try { fs.unlinkSync(tempAudioPath); } catch {}

      const mimeTypes: Record<string, string> = {
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        webm: 'audio/webm',
      };

      setRenderProgress(renderId, {
        stage: 'ready',
        percent: 100,
        filePath: tempAudioOutPath,
        contentType: mimeTypes[ext] || 'audio/mp4',
        filename,
        ext,
        downloadUrl: `/api/stream?action=download&renderId=${encodeURIComponent(renderId)}&filename=${encodeURIComponent(filename)}&ext=${ext}`,
        message: 'Audio siap! Mengunduh ke perangkat Anda…',
      });
    } catch (err: unknown) {
      try { fs.unlinkSync(tempAudioPath); } catch {}
      try { fs.unlinkSync(tempAudioOutPath); } catch {}
      if (isAborted()) {
        console.log(`[executeBackgroundRender] Audio render ${renderId} cancelled by client.`);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort') || msg.includes('cancel') || msg.includes('batal')) return;
      setRenderProgress(renderId, {
        stage: 'error',
        percent: 0,
        message: `Gagal memproses audio: ${msg}`,
      });
    }
    return;
  }

  // ── BRANCH 2: Video Muxing (YouTube separate Video + Audio) ───────────────
  if (platform === 'youtube') {
    // Update progress so client sees we're actively working (not stalled at 1%)
    setRenderProgress(renderId, {
      stage: 'downloading',
      percent: 2,
      downloadedBytes: 0,
      totalBytes: 0,
      message: 'Mengambil informasi video dari YouTube…',
    });

    // Race yt-dlp resolution against a 90-second safety timeout
    const formats = await Promise.race([
      resolveYouTubeFormats(decodedUrl, cookieFile, hasCookies),
      new Promise<CachedFormat[]>((_, reject) =>
        setTimeout(() => reject(new Error('Format resolution timeout (90s)')), 90_000)
      ),
    ]).catch((err) => {
      console.error('[executeBackgroundRender] YouTube video format resolution failed:', err);
      return [] as CachedFormat[];
    });
    if (!formats || formats.length === 0) {
      setRenderProgress(renderId, {
        stage: 'error',
        percent: 0,
        message: 'Gagal mengambil format video YouTube. YouTube mungkin membatasi akses atau meminta verifikasi.',
      });
      return;
    }

    const videoFmt =
      formats.find((f) => String(f.format_id) === String(formatId)) ||
      formats.find((f) => f.vcodec && f.vcodec !== 'none' && f.url);

    const audioFormats = formats.filter(
      (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url
    );
    let audioFmt =
      ext === 'webm'
        ? audioFormats.find((f) => f.ext === 'webm' || f.acodec?.includes('opus'))
        : audioFormats.find((f) => f.ext === 'm4a' || f.acodec?.includes('mp4a'));
    if (!audioFmt) audioFmt = audioFormats[0];

    if (!videoFmt || !audioFmt || !videoFmt.url || !audioFmt.url) {
      setRenderProgress(renderId, {
        stage: 'error',
        percent: 0,
        message: 'Format video atau audio yang diminta tidak tersedia untuk video ini.',
      });
      return;
    }

    const [vMeta, aMeta] = await Promise.all([
      videoFmt.filesize ? { success: true, size: videoFmt.filesize, error: undefined } : verifyStreamMetadata(videoFmt.url, videoFmt.http_headers),
      audioFmt.filesize ? { success: true, size: audioFmt.filesize, error: undefined } : verifyStreamMetadata(audioFmt.url, audioFmt.http_headers),
    ]);

    if (!vMeta.success || vMeta.size <= 0 || !aMeta.success || aMeta.size <= 0) {
      deleteFormatInfo(decodedUrl);
      const errMsg = !vMeta.success ? vMeta.error : aMeta.error;
      setRenderProgress(renderId, {
        stage: 'error',
        percent: 0,
        message: errMsg || 'Gagal memverifikasi metadata stream video atau audio dari YouTube.',
      });
      return;
    }

    const vSize = vMeta.size;
    const aSize = aMeta.size;
    const totalCombined = vSize + aSize;

    setRenderProgress(renderId, {
      stage: 'downloading',
      percent: 5,
      downloadedBytes: 0,
      totalBytes: totalCombined,
      message: 'Video Anda sedang diunduh otomatis…',
    });

    const tempVideoPath = path.join(tempDir, `v_${sessionId}.${videoFmt.ext || 'mp4'}`);
    const tempAudioPath = path.join(tempDir, `a_${sessionId}.${audioFmt.ext || 'm4a'}`);
    const tempOutPath = path.join(tempDir, `out_${sessionId}.${ext}`);
    addTempFile(tempVideoPath);
    addTempFile(tempAudioPath);
    addTempFile(tempOutPath);

    let downloadedV = 0;
    let downloadedA = 0;

    const reportProgress = () => {
      const sum = downloadedV + downloadedA;
      const pct = Math.min(90, Math.max(5, Math.round((sum / totalCombined) * 90)));
      const isGigabytes = totalCombined >= 1024 * 1024 * 1024;
      const formattedSum = isGigabytes
        ? `${(sum / (1024 * 1024 * 1024)).toFixed(2)} GB`
        : `${(sum / (1024 * 1024)).toFixed(1)} MB`;
      const formattedTotal = isGigabytes
        ? `${(totalCombined / (1024 * 1024 * 1024)).toFixed(2)} GB`
        : `${(totalCombined / (1024 * 1024)).toFixed(1)} MB`;

      setRenderProgress(renderId, {
        stage: 'downloading',
        percent: pct,
        downloadedBytes: sum,
        totalBytes: totalCombined,
        message: `Video Anda sedang diunduh otomatis: ${pct}% (${formattedSum} / ${formattedTotal})`,
      });
    };

    try {
      if (isAborted()) return;

      await Promise.all([
        downloadChunkedRange(videoFmt.url, tempVideoPath, vSize, {
          headers: videoFmt.http_headers,
          signal,
          concurrency: 6,
          onProgress: (vBytes) => {
            downloadedV = vBytes;
            reportProgress();
          },
        }),
        downloadChunkedRange(audioFmt.url, tempAudioPath, aSize, {
          headers: audioFmt.http_headers,
          signal,
          concurrency: 2,
          onProgress: (aBytes) => {
            downloadedA = aBytes;
            reportProgress();
          },
        }),
      ]);

      if (isAborted()) return;

      const durSec = duration && duration > 0 ? duration : 0;
      const durStr = durSec > 0 ? formatDuration(durSec) : '';

      setRenderProgress(renderId, {
        stage: 'merging',
        percent: 92,
        message: durStr
          ? `Sedang merender video kualitas terbaik (${durStr})…`
          : 'Sedang merender video kualitas terbaik…',
      });

      await mergeAudioVideoLocally(
        tempVideoPath,
        tempAudioPath,
        tempOutPath,
        ext,
        ffmpegPath,
        (p) => {
          if (!renderId) return;
          let pct = 92;
          if (durSec > 0) {
            pct = Math.min(99, Math.round(92 + (p.seconds / durSec) * 7));
          }
          const msg = durStr
            ? `Menggabungkan video & audio: ${p.timeStr} / ${durStr} (${pct}%) • Kecepatan ${p.speed}x`
            : `Menggabungkan video & audio: ${p.timeStr} • Kecepatan ${p.speed}x`;
          setRenderProgress(renderId, {
            stage: 'merging',
            percent: pct,
            message: msg,
          });
        },
        signal
      );

      if (isAborted()) return;

      try { fs.unlinkSync(tempVideoPath); } catch {}
      try { fs.unlinkSync(tempAudioPath); } catch {}

      const mimeTypes: Record<string, string> = {
        mp4: 'video/mp4',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        m4a: 'audio/mp4',
      };
      const contentType = mimeTypes[ext] || 'video/mp4';

      setRenderProgress(renderId, {
        stage: 'ready',
        percent: 100,
        filePath: tempOutPath,
        contentType,
        filename,
        ext,
        downloadUrl: `/api/stream?action=download&renderId=${encodeURIComponent(renderId)}&filename=${encodeURIComponent(filename)}&ext=${encodeURIComponent(ext)}`,
        message: 'Render selesai! Mengunduh ke perangkat Anda…',
      });
    } catch (err: unknown) {
      try { fs.unlinkSync(tempVideoPath); } catch {}
      try { fs.unlinkSync(tempAudioPath); } catch {}
      try { fs.unlinkSync(tempOutPath); } catch {}
      if (isAborted()) {
        console.log(`[executeBackgroundRender] Video render ${renderId} cancelled by client.`);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort') || msg.includes('cancel') || msg.includes('batal')) return;
      setRenderProgress(renderId, {
        stage: 'error',
        percent: 0,
        message: `Gagal mengunduh video: ${msg}`,
      });
    }
    return;
  }

  setRenderProgress(renderId, {
    stage: 'error',
    percent: 0,
    message: 'Tipe render tidak dikenali.',
  });

  } catch (fatalErr: unknown) {
    // ── Global safety net: catch ANY unhandled error in background render ──
    // This guarantees the client NEVER gets stuck polling at 1% forever.
    const fatalMsg = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    console.error(`[executeBackgroundRender] Unhandled fatal error for renderId=${renderId}:`, fatalMsg);
    try {
      setRenderProgress(renderId, {
        stage: 'error',
        percent: 0,
        message: `Terjadi kesalahan tak terduga saat memproses file: ${fatalMsg}`,
      });
    } catch {
      // Last resort: if even setRenderProgress fails, there's nothing more we can do
    }
  } finally {
    decrementActiveTasks();
    if (clientIp) {
      recordIpActivity(clientIp, { decrementConcurrent: true });
    }
    endRenderSession(renderId);
  }
}

// ─── Route Handler ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<Response> {
  const clientIp = getClientIp(req);
  const country = getClientCountry(req);
  const userAgent = req.headers.get('user-agent') || '';

  // ── Anti-Abuse & Ban Check ────────────────────────────────────────────────
  const accessCheck = checkIpAccess(clientIp, userAgent);
  if (!accessCheck.allowed) {
    logRequest({
      ip: clientIp,
      country,
      endpoint: '/api/stream',
      action: req.nextUrl.searchParams.get('action') || 'direct',
      statusCode: 403,
      durationMs: 0,
      bytesTransferred: 0,
      userAgent,
      isBot: isBotUserAgent(userAgent),
    });
    return jsonError(accessCheck.reason || 'Akses ditolak.', 403);
  }

  const { searchParams } = req.nextUrl;
  const action = searchParams.get('action');
  const renderId = searchParams.get('renderId');

  // ── Action: 'download' (Instant delivery of pre-rendered file) ─────────
  if (action === 'download') {
    if (!renderId) return jsonError('Missing renderId parameter.', 400);

    const progress = getRenderProgress(renderId);
    if (!progress || progress.stage !== 'ready' || !progress.filePath) {
      return jsonError('File belum siap diunduh atau telah kedaluwarsa.', 404);
    }

    if (!fs.existsSync(progress.filePath)) {
      deleteRenderProgress(renderId);
      return jsonError('File unduhan tidak ditemukan di server.', 404);
    }

    const filePath = progress.filePath;
    const stat = fs.statSync(filePath);
    const downloadExt = progress.ext || searchParams.get('ext') || 'mp4';
    const downloadFilename = progress.filename || searchParams.get('filename') || 'download';
    const contentType = progress.contentType || 'application/octet-stream';

    let isStreamClosed = false;
    const nodeStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer | string) => {
          if (isStreamClosed) return;
          try {
            const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
            controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
            if (controller.desiredSize !== null && controller.desiredSize <= 0) {
              nodeStream.pause();
            }
          } catch {
            isStreamClosed = true;
            nodeStream.destroy();
          }
        });
        nodeStream.on('end', () => {
          if (!isStreamClosed) {
            isStreamClosed = true;
            try { controller.close(); } catch {}
          }
          try { fs.unlinkSync(filePath); } catch {}
          deleteRenderProgress(renderId);
          recordIpActivity(clientIp, { bytes: stat.size, userAgent });
          logRequest({
            ip: clientIp,
            country,
            endpoint: '/api/stream',
            action: 'download',
            platform: (searchParams.get('platform') || 'youtube') as string,
            format: downloadExt,
            title: downloadFilename,
            statusCode: 200,
            durationMs: 0,
            bytesTransferred: stat.size,
            userAgent,
            isBot: isBotUserAgent(userAgent),
          });
        });
        nodeStream.on('error', (err) => {
          if (!isStreamClosed) {
            isStreamClosed = true;
            try { controller.error(err); } catch {}
          }
          try { fs.unlinkSync(filePath); } catch {}
          deleteRenderProgress(renderId);
        });
      },
      pull() {
        if (!isStreamClosed) nodeStream.resume();
      },
      cancel() {
        isStreamClosed = true;
        nodeStream.destroy();
        try { fs.unlinkSync(filePath); } catch {}
        deleteRenderProgress(renderId);
      },
    });

    req.signal.addEventListener(
      'abort',
      () => {
        isStreamClosed = true;
        nodeStream.destroy();
        try { fs.unlinkSync(filePath); } catch {}
        deleteRenderProgress(renderId);
      },
      { once: true }
    );

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadFilename)}.${downloadExt}"`,
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // ── Action: 'cancel' (Instantly abort any ongoing render and clean up) ──
  if (action === 'cancel') {
    if (!renderId) return jsonError('Missing renderId parameter.', 400);
    cancelRenderSession(renderId, 'Client requested cancel via /api/stream');
    return Response.json({ success: true, message: 'Render cancelled' });
  }

  // ── Action: 'prepare' (Asynchronously kick off render without blocking HTTP) ──
  if (action === 'prepare') {
    const url = searchParams.get('url');
    if (!url || !renderId) {
      return jsonError('Missing url or renderId parameter.', 400);
    }
    const decodedUrl = decodeURIComponent(url);
    const filename = searchParams.get('filename') ?? 'download';
    const platform = (searchParams.get('platform') ?? '') as Platform | '';
    const formatId = searchParams.get('formatId');
    const extParam = searchParams.get('ext');
    const audioOnly = searchParams.get('audioOnly') === 'true';
    const ext = extParam ? extParam.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : (audioOnly ? 'm4a' : 'mp4');
    const bitrate = searchParams.get('bitrate') ?? '320k';
    const durationParam = searchParams.get('duration');
    const duration = parseDurationToSeconds(durationParam);

    setRenderProgress(renderId, {
      stage: 'downloading',
      percent: 1,
      downloadedBytes: 0,
      totalBytes: 0,
      message: 'Menyiapkan proses unduhan…',
    });

    void executeBackgroundRender({
      decodedUrl,
      platform,
      formatId,
      ext,
      filename,
      renderId,
      bitrate,
      duration,
      audioOnly,
      clientIp,
    });

    recordIpActivity(clientIp, { userAgent, incrementConcurrent: true });
    logRequest({
      ip: clientIp,
      country,
      endpoint: '/api/stream',
      action: 'prepare',
      platform: (platform || 'youtube') as string,
      format: ext,
      title: filename,
      statusCode: 200,
      durationMs: 0,
      bytesTransferred: 0,
      userAgent,
      isBot: isBotUserAgent(userAgent),
    });

    return Response.json({
      success: true,
      message: 'Proses unduhan dimulai',
      renderId,
    });
  }

  const url = searchParams.get('url');
  const filename = searchParams.get('filename') ?? 'download';
  const platform = (searchParams.get('platform') ?? '') as Platform | '';
  const audioOnly = searchParams.get('audioOnly') === 'true';
  const isCobaltUrl = searchParams.get('isCobaltUrl') === 'true';
  const isDirectUrl = searchParams.get('isDirectUrl') === 'true';
  const formatId = searchParams.get('formatId');
  const extParam = searchParams.get('ext');
  const requiresRender = searchParams.get('requiresRender') === 'true';

  if (!url) {
    return jsonError('Missing url parameter.', 400);
  }

  const decodedUrl = decodeURIComponent(url);
  const engineType = getEngineType();

  // Range header forwarding (pause/resume support)
  const clientRangeHeader = req.headers.get('range');

  // ── Build composite AbortSignal ─────────────────────────────────────────
  // req.signal is Next.js App Router's built-in client-disconnect signal.
  // It fires when the user closes their browser tab or cancels the download.
  const { signal: compositeSignal, clearConnectionTimeout } = createCompositeSignal(
    req.signal,
    CONNECTION_TIMEOUT_MS,
  );

  try {
    let cdnUrl: string;
    let matchedFormat: CachedFormat | undefined;
    const ext = extParam ? extParam.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() : (audioOnly ? 'm4a' : 'mp4');

    // ── Step 1: Resolve CDN URL ────────────────────────────────────────────
    if (
      isDirectUrl ||
      isCobaltUrl ||
      engineType === 'cobalt' ||
      decodedUrl.includes('tikwm.com') ||
      decodedUrl.includes('.tiktokcdn.') ||
      decodedUrl.includes('tiktokv.com')
    ) {
      // Pre-resolved direct CDN URLs — no yt-dlp needed
      cdnUrl = decodedUrl;
    } else {
      const cookieFilenames: Record<string, string> = {
        youtube: '.youtube-cookies.txt',
        instagram: '.instagram-cookies.txt',
        tiktok: '.tiktok-cookies.txt',
      };
      const platformCookie = cookieFilenames[platform as string] ?? '.youtube-cookies.txt';
      const cookieFile = path.join(process.cwd(), 'data', platformCookie);
      const hasCookies = fs.existsSync(cookieFile);

      // ── UNIVERSAL AUDIO BRANCH: MP3, M4A, AAC, WEBM Audio ─────
      const isAudioDownload =
        platform === 'youtube' &&
        (Boolean(audioOnly) || ext === 'mp3' || ext === 'm4a' || ext === 'aac' || (ext === 'webm' && Boolean(audioOnly)));

      if (isAudioDownload) {
        // Cancel connection timeout immediately — render can take as long as needed without artificial 60s cap
        clearConnectionTimeout();

        const extUpper = ext.toUpperCase();
        if (renderId) {
          setRenderProgress(renderId, {
            stage: 'downloading',
            percent: 1,
            downloadedBytes: 0,
            totalBytes: 0,
            message: `Menyiapkan format audio ${extUpper}…`,
          });
        }

        const bitrateParam = searchParams.get('bitrate');
        const bitrate = bitrateParam || (ext === 'mp3' ? '320k' : 'original');

        const formats = await resolveYouTubeFormats(decodedUrl, cookieFile, hasCookies, compositeSignal);
        const audioFormats = formats.filter(
          (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url
        );

        let bestAudio: CachedFormat | undefined;
        if (ext === 'm4a' || ext === 'aac' || ext === 'mp3') {
          bestAudio = audioFormats.find((f) => f.ext === 'm4a' || f.acodec?.includes('mp4a'));
        } else if (ext === 'webm') {
          bestAudio = audioFormats.find((f) => f.ext === 'webm' || f.acodec?.includes('opus'));
        }
        if (!bestAudio) {
          audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
          bestAudio = audioFormats[0];
        }

        if (!bestAudio || !bestAudio.url) {
          if (renderId) {
            setRenderProgress(renderId, {
              stage: 'error',
              percent: 0,
              message: `Tidak ada stream audio yang tersedia untuk format ${extUpper}.`,
            });
          }
          return jsonError(`No audio stream available for ${extUpper}.`, 404);
        }

        const ffmpegPath = getFFmpegBinaryPath();
        const tempDir = path.join(process.cwd(), 'data', 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const tempAudioPath = path.join(tempDir, `audio_${sessionId}.${bestAudio.ext || 'm4a'}`);
        const tempAudioOutPath = path.join(tempDir, `out_${sessionId}.${ext}`);

        try {
          const meta = await verifyStreamMetadata(bestAudio.url, bestAudio.http_headers);
          if (!meta.success || meta.size <= 0) {
            deleteFormatInfo(decodedUrl);
            if (renderId) {
              setRenderProgress(renderId, {
                stage: 'error',
                percent: 0,
                message: meta.error || 'Gagal memverifikasi metadata stream audio.',
              });
            }
            return jsonError(meta.error || 'Invalid audio stream metadata.', 502);
          }
          const audioSize = meta.size;

          if (renderId) {
            setRenderProgress(renderId, {
              stage: 'downloading',
              percent: 5,
              downloadedBytes: 0,
              totalBytes: audioSize,
              message: `Mengunduh audio ${extUpper} kecepatan penuh…`,
            });
          }

          // Step 1: Rapid chunked range download with live progress (0% - 50%)
          await downloadChunkedRange(bestAudio.url, tempAudioPath, audioSize, {
            headers: bestAudio.http_headers,
            signal: compositeSignal,
            concurrency: 6,
            onProgress: (bytes, total) => {
              if (renderId) {
                const dlPct = Math.min(50, Math.max(1, Math.round((bytes / total) * 50)));
                setRenderProgress(renderId, {
                  stage: 'downloading',
                  percent: dlPct,
                  downloadedBytes: bytes,
                  totalBytes: total,
                  message: `Mengunduh audio: ${dlPct * 2}%`,
                });
              }
            },
          });

          if (renderId) {
            setRenderProgress(renderId, {
              stage: 'merging',
              percent: 50,
              message: ext === 'mp3' ? 'Mengonversi ke MP3 kualitas tinggi…' : `Menyiapkan format audio ${extUpper} instan…`,
            });
          }

          const durSec = parseDurationToSeconds(searchParams.get('duration'));
          const durStr = durSec > 0 ? formatDuration(durSec) : '';

          // Step 2: Stream copy for M4A/AAC/WEBM (<1.5s) or fast multi-core LAME transcode for MP3
          await transcodeAudioLocally(
            tempAudioPath,
            tempAudioOutPath,
            ext,
            bitrate,
            ffmpegPath,
            (p) => {
              if (!renderId) return;
              const convPct = durSec > 0 ? Math.min(100, Math.round((p.seconds / durSec) * 100)) : 50;
              const overallPct = Math.min(99, Math.round(50 + (convPct * 0.49)));
              const msg = ext === 'mp3'
                ? (durStr
                    ? `Mengonversi ke MP3: ${p.timeStr} / ${durStr} (${convPct}%) • Kecepatan ${p.speed}x`
                    : `Mengonversi ke MP3: ${p.timeStr} (${convPct}%) • Kecepatan ${p.speed}x`)
                : `Menyiapkan format ${extUpper} instan: ${p.timeStr}`;
              setRenderProgress(renderId, {
                stage: 'merging',
                percent: overallPct,
                message: msg,
              });
            },
            compositeSignal,
            durSec
          );

          if (renderId) {
            setRenderProgress(renderId, {
              stage: 'ready',
              percent: 100,
              message: 'Audio siap! Mengunduh ke perangkat Anda…',
            });
          }

          try {
            fs.unlinkSync(tempAudioPath);
          } catch {}

          const stat = fs.statSync(tempAudioOutPath);
          let isAudioStreamClosed = false;
          const nodeStream = fs.createReadStream(tempAudioOutPath, { highWaterMark: 64 * 1024 });

          const mimeTypes: Record<string, string> = {
            mp3: 'audio/mpeg',
            m4a: 'audio/mp4',
            aac: 'audio/aac',
            webm: 'audio/webm',
          };
          const contentType = mimeTypes[ext] || 'audio/mp4';

          const webStream = new ReadableStream<Uint8Array>({
            start(controller) {
              nodeStream.on('data', (chunk: Buffer | string) => {
                if (isAudioStreamClosed) return;
                try {
                  const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
                  controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
                  if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                    nodeStream.pause();
                  }
                } catch {
                  isAudioStreamClosed = true;
                  nodeStream.destroy();
                }
              });
              nodeStream.on('end', () => {
                if (!isAudioStreamClosed) {
                  isAudioStreamClosed = true;
                  try { controller.close(); } catch {}
                }
                try {
                  fs.unlinkSync(tempAudioOutPath);
                } catch {}
                if (renderId) deleteRenderProgress(renderId);
              });
              nodeStream.on('error', (err) => {
                if (!isAudioStreamClosed) {
                  isAudioStreamClosed = true;
                  try { controller.error(err); } catch {}
                }
                try {
                  fs.unlinkSync(tempAudioOutPath);
                } catch {}
                if (renderId) deleteRenderProgress(renderId);
              });
            },
            pull() {
              if (!isAudioStreamClosed) nodeStream.resume();
            },
            cancel() {
              isAudioStreamClosed = true;
              nodeStream.destroy();
              try {
                fs.unlinkSync(tempAudioOutPath);
              } catch {}
              if (renderId) deleteRenderProgress(renderId);
            },
          });

          compositeSignal.addEventListener(
            'abort',
            () => {
              isAudioStreamClosed = true;
              nodeStream.destroy();
              try {
                fs.unlinkSync(tempAudioOutPath);
              } catch {}
              try {
                fs.unlinkSync(tempAudioPath);
              } catch {}
              if (renderId) deleteRenderProgress(renderId);
            },
            { once: true }
          );

          return new Response(webStream, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Content-Length': stat.size.toString(),
              'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.${ext}"`,
              'Cache-Control': 'no-store',
              'Accept-Ranges': 'bytes',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        } catch (err) {
          try {
            fs.unlinkSync(tempAudioPath);
          } catch {}
          try {
            fs.unlinkSync(tempAudioOutPath);
          } catch {}
          if (renderId) {
            setRenderProgress(renderId, {
              stage: 'error',
              percent: 0,
              message: err instanceof Error ? err.message : 'Gagal memproses audio',
            });
          }
          throw err;
        }
      }

      // ── MUXING BRANCH: High-Speed Parallel Chunked Muxing (Bypasses 2.2 Mbps cap) ──────
      if (platform === 'youtube' && requiresRender && formatId && !audioOnly && !isAudioDownload) {
        // Cancel connection timeout immediately — render of large 10GB-50GB files takes minutes
        // and must not be killed by the 60s timeout!
        clearConnectionTimeout();

        if (renderId) {
          setRenderProgress(renderId, {
            stage: 'downloading',
            percent: 1,
            downloadedBytes: 0,
            totalBytes: 0,
            message: 'Video Anda sedang diunduh otomatis…',
          });
        }

        const formats = await resolveYouTubeFormats(decodedUrl, cookieFile, hasCookies, compositeSignal);
        if (!formats || formats.length === 0) {
          if (renderId) {
            setRenderProgress(renderId, {
              stage: 'error',
              percent: 0,
              message: 'Gagal mengambil format video YouTube. YouTube mungkin membatasi akses atau meminta verifikasi.',
            });
          }
          return jsonError('Failed to resolve YouTube video streams.', 502);
        }

        // Find requested video stream
        const videoFmt =
          formats.find((f) => String(f.format_id) === String(formatId)) ||
          formats.find((f) => f.vcodec && f.vcodec !== 'none' && f.url);

        // Find best compatible audio stream
        const audioFormats = formats.filter(
          (f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none') && f.url
        );
        let audioFmt =
          ext === 'webm'
            ? audioFormats.find((f) => f.ext === 'webm' || f.acodec?.includes('opus'))
            : audioFormats.find((f) => f.ext === 'm4a' || f.acodec?.includes('mp4a'));
        if (!audioFmt) audioFmt = audioFormats[0];

        if (!videoFmt || !audioFmt || !videoFmt.url || !audioFmt.url) {
          if (renderId) {
            setRenderProgress(renderId, {
              stage: 'error',
              percent: 0,
              message: 'Format video atau audio yang diminta tidak tersedia untuk video ini.',
            });
          }
          return jsonError('Requested video or audio format not available.', 404);
        }

        const ffmpegPath = getFFmpegBinaryPath();
        const tempDir = path.join(process.cwd(), 'data', 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const tempVideoPath = path.join(tempDir, `v_${sessionId}.${videoFmt.ext || 'mp4'}`);
        const tempAudioPath = path.join(tempDir, `a_${sessionId}.${audioFmt.ext || 'm4a'}`);
        const tempOutPath = path.join(tempDir, `out_${sessionId}.${ext}`);

        try {
          const [vMeta, aMeta] = await Promise.all([
            videoFmt.filesize ? { success: true, size: videoFmt.filesize, error: undefined } : verifyStreamMetadata(videoFmt.url, videoFmt.http_headers),
            audioFmt.filesize ? { success: true, size: audioFmt.filesize, error: undefined } : verifyStreamMetadata(audioFmt.url, audioFmt.http_headers),
          ]);

          if (!vMeta.success || vMeta.size <= 0 || !aMeta.success || aMeta.size <= 0) {
            deleteFormatInfo(decodedUrl);
            const errMsg = !vMeta.success ? vMeta.error : aMeta.error;
            if (renderId) {
              setRenderProgress(renderId, {
                stage: 'error',
                percent: 0,
                message: errMsg || 'Gagal memverifikasi metadata stream video atau audio.',
              });
            }
            return jsonError(errMsg || 'Invalid video or audio stream metadata.', 502);
          }

          const vSize = vMeta.size;
          const aSize = aMeta.size;
          const totalCombined = vSize + aSize;
          let downloadedV = 0;
          let downloadedA = 0;

            const reportDownloadProgress = () => {
              if (!renderId) return;
              const sum = downloadedV + downloadedA;
              const pct = Math.min(90, Math.max(1, Math.round((sum / totalCombined) * 90)));
              const isGigabytes = totalCombined >= 1024 * 1024 * 1024;
              const formattedSum = isGigabytes
                ? `${(sum / (1024 * 1024 * 1024)).toFixed(2)} GB`
                : `${(sum / (1024 * 1024)).toFixed(1)} MB`;
              const formattedTotal = isGigabytes
                ? `${(totalCombined / (1024 * 1024 * 1024)).toFixed(2)} GB`
                : `${(totalCombined / (1024 * 1024)).toFixed(1)} MB`;

              setRenderProgress(renderId, {
                stage: 'downloading',
                percent: pct,
                downloadedBytes: sum,
                totalBytes: totalCombined,
                message: `Video Anda sedang diunduh otomatis: ${pct}% (${formattedSum} / ${formattedTotal})`,
              });
            };

            reportDownloadProgress();

            // Step 1: Download video and audio streams concurrently with multi-worker Range requests
            // This achieves 150–300+ Mbps, bypassing YouTube's 2.2 Mbps pacing throttle!
            await Promise.all([
              downloadChunkedRange(videoFmt.url, tempVideoPath, vSize, {
                headers: videoFmt.http_headers,
                signal: compositeSignal,
                concurrency: 6,
                onProgress: (vBytes) => {
                  downloadedV = vBytes;
                  reportDownloadProgress();
                },
              }),
              downloadChunkedRange(audioFmt.url, tempAudioPath, aSize, {
                headers: audioFmt.http_headers,
                signal: compositeSignal,
                concurrency: 2,
                onProgress: (aBytes) => {
                  downloadedA = aBytes;
                  reportDownloadProgress();
                },
              }),
            ]);

            if (renderId) {
              setRenderProgress(renderId, {
                stage: 'merging',
                percent: 92,
                message: 'Sedang merender video kualitas terbaik…',
              });
            }

            const durSec = parseDurationToSeconds(searchParams.get('duration'));
            const durStr = durSec > 0 ? formatDuration(durSec) : '';

            // Step 2: Instantaneous local FFmpeg remuxing on NVMe/SSD
            await mergeAudioVideoLocally(
              tempVideoPath,
              tempAudioPath,
              tempOutPath,
              ext,
              ffmpegPath,
              (p) => {
                if (!renderId) return;
                let pct = 92;
                if (durSec > 0) {
                  pct = Math.min(99, Math.round(92 + (p.seconds / durSec) * 7));
                }
                const msg = durStr
                  ? `Menggabungkan video & audio: ${p.timeStr} / ${durStr} (${pct}%) • Kecepatan ${p.speed}x`
                  : `Menggabungkan video & audio: ${p.timeStr} • Kecepatan ${p.speed}x`;
                setRenderProgress(renderId, {
                  stage: 'merging',
                  percent: pct,
                  message: msg,
                });
              },
              compositeSignal
            );

            if (renderId) {
              setRenderProgress(renderId, {
                stage: 'ready',
                percent: 100,
                message: 'Render selesai! Mengunduh ke perangkat Anda…',
              });
            }

            // Clean up raw separate streams immediately
            try {
              fs.unlinkSync(tempVideoPath);
            } catch {}
            try {
              fs.unlinkSync(tempAudioPath);
            } catch {}

            const stat = fs.statSync(tempOutPath);
            let isVideoClosed = false;
            const nodeStream = fs.createReadStream(tempOutPath, { highWaterMark: 64 * 1024 });

            const mimeTypes: Record<string, string> = {
              mp4: 'video/mp4',
              webm: 'video/webm',
              mkv: 'video/x-matroska',
              m4a: 'audio/mp4',
            };
            const contentType = mimeTypes[ext] ?? (ext === 'webm' ? 'video/webm' : 'video/mp4');

            const webStream = new ReadableStream<Uint8Array>({
              start(controller) {
                nodeStream.on('data', (chunk: Buffer | string) => {
                  if (isVideoClosed) return;
                  try {
                    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
                    controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
                    if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                      nodeStream.pause();
                    }
                  } catch {
                    isVideoClosed = true;
                    nodeStream.destroy();
                  }
                });
                nodeStream.on('end', () => {
                  if (!isVideoClosed) {
                    isVideoClosed = true;
                    try { controller.close(); } catch {}
                  }
                  try {
                    fs.unlinkSync(tempOutPath);
                  } catch {}
                  if (renderId) deleteRenderProgress(renderId);
                });
                nodeStream.on('error', (err) => {
                  if (!isVideoClosed) {
                    isVideoClosed = true;
                    try { controller.error(err); } catch {}
                  }
                  try {
                    fs.unlinkSync(tempOutPath);
                  } catch {}
                  if (renderId) deleteRenderProgress(renderId);
                });
              },
              pull() {
                if (!isVideoClosed) nodeStream.resume();
              },
              cancel() {
                isVideoClosed = true;
                nodeStream.destroy();
                try {
                  fs.unlinkSync(tempOutPath);
                } catch {}
                if (renderId) deleteRenderProgress(renderId);
              },
            });

            compositeSignal.addEventListener(
              'abort',
              () => {
                isVideoClosed = true;
                nodeStream.destroy();
                try {
                  fs.unlinkSync(tempOutPath);
                } catch {}
                try {
                  fs.unlinkSync(tempVideoPath);
                } catch {}
                try {
                  fs.unlinkSync(tempAudioPath);
                } catch {}
                if (renderId) deleteRenderProgress(renderId);
              },
              { once: true }
            );

            return new Response(webStream, {
              status: 200,
              headers: {
                'Content-Type': contentType,
                'Content-Length': stat.size.toString(),
                'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}.${ext}"`,
                'Cache-Control': 'no-store',
                'Accept-Ranges': 'bytes',
                'X-Content-Type-Options': 'nosniff',
              },
            });
          } catch (err) {
            try {
              fs.unlinkSync(tempVideoPath);
            } catch {}
            try {
              fs.unlinkSync(tempAudioPath);
            } catch {}
            try {
              fs.unlinkSync(tempOutPath);
            } catch {}
            if (renderId) {
              setRenderProgress(renderId, {
                stage: 'error',
                percent: 0,
                message: err instanceof Error ? err.message : 'Gagal mengunduh video',
              });
            }
            throw err;
          }
        }

      // yt-dlp single stream resolution: call --get-url
      const formatKey = audioOnly
        ? platform === 'youtube' ? 'youtube_audio' : 'audio'
        : (platform as string) || 'youtube';
      const format = formatId
        ? formatId
        : (YTDLP_FORMAT_MAP[formatKey] ?? YTDLP_FORMAT_MAP['youtube']);

      let result = '';
      if (platform === 'youtube') {
        // ── Fast-path: Check in-memory format cache from /api/resolve (0ms instant streaming) ──
        const cached = getFormatInfo(decodedUrl);
        if (cached && cached.length > 0) {
          matchedFormat = formatId
            ? cached.find((f) => String(f.format_id) === String(formatId))
            : audioOnly
            ? cached.find((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
            : cached.find((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none');
          if (matchedFormat && matchedFormat.url) {
            result = matchedFormat.url;
          }
        }

        if (!result) {
          const streamAttempts = [
            // 1. Native yt-dlp routing with cookies (Handles all formats natively: 18, 140, 251, etc.)
            ...(hasCookies ? [{ cookies: cookieFile }] : []),
            // 2. Web client with cookies
            ...(hasCookies ? [{ extractorArgs: 'youtube:player_client=web', cookies: cookieFile }] : []),
            // 3. Native yt-dlp routing without cookies
            {},
            // 4. Web client without cookies
            { extractorArgs: 'youtube:player_client=web' },
            // 5. Fallback for restricted videos (tv_embedded,web)
            ...(hasCookies ? [{ extractorArgs: 'youtube:player_client=tv_embedded,web', cookies: cookieFile }] : []),
            { extractorArgs: 'youtube:player_client=tv_embedded,web' },
          ];

          let lastStreamError = '';
          for (const attempt of streamAttempts) {
            if (compositeSignal.aborted) break;
            try {
              const res = (await youtubeDl(decodedUrl, {
                getUrl: true,
                noCheckCertificates: true,
                noWarnings: true,
                format,
                ...attempt,
              })) as string;

              if (res && typeof res === 'string' && res.trim().length > 0) {
                result = res;
                break;
              }
            } catch (err: unknown) {
              lastStreamError = err instanceof Error ? err.message : String(err);
              continue;
            }
          }

          if (!result && lastStreamError) {
            console.error('[/api/stream YT-DLP ERROR]:', lastStreamError);
          }
        }
      } else {
        const streamOptions: Record<string, unknown> = {
          getUrl: true,
          noCheckCertificates: true,
          noWarnings: true,
          format: format || 'best[ext=mp4]/best',
          addHeader: [
            `referer:${PLATFORM_REFERERS[platform as Platform] ?? 'https://www.youtube.com/'}`,
            `user-agent:${UA}`,
          ],
        };
        if (hasCookies) {
          streamOptions.cookies = cookieFile;
        }
        result = (await youtubeDl(decodedUrl, streamOptions)) as string;
      }

      // Guard: if composite signal fired while yt-dlp was running, bail now
      if (compositeSignal.aborted) {
        return jsonError('Request was aborted.', 499);
      }

      const lines = String(result).trim().split('\n').filter(Boolean);
      cdnUrl = lines[lines.length - 1] ?? '';

      if (!cdnUrl || !cdnUrl.startsWith('http')) {
        return jsonError('Could not resolve a valid download URL. The video may be unavailable.', 500);
      }
    }

    // ── Step 2: Fetch CDN URL — with composite signal ──────────────────────
    //
    // The composite signal will abort the fetch if:
    //   A) 15s connection timeout fires before headers arrive, OR
    //   B) req.signal fires (client disconnects at any point)
    //
    // This guarantees NO dangling connections draining RAM/bandwidth.
    const upstreamHeaders: Record<string, string> = {
      'User-Agent': UA,
    };
    if (platform !== 'youtube') {
      upstreamHeaders['Referer'] = PLATFORM_REFERERS[platform as Platform] ?? 'https://www.youtube.com/';
    }

    let isSynthesizedRange = false;
    if (clientRangeHeader) {
      upstreamHeaders['Range'] = clientRangeHeader;
    } else if (platform === 'youtube') {
      // ── Anti-Throttle Engine for YouTube CDN ─────────────────────────────
      // Google severely throttles requests without Range headers to 32 KB/s.
      // By sending an explicit Range header matching the file size, Google CDN provides
      // unthrottled burst bandwidth (15-50 MB/s).
      let targetBytes = matchedFormat?.filesize || matchedFormat?.filesize_approx;
      if (!targetBytes || targetBytes <= 0) {
        targetBytes = await getRemoteFileSize(cdnUrl);
      }
      if (targetBytes && targetBytes > 0) {
        upstreamHeaders['Range'] = `bytes=0-${targetBytes - 1}`;
        isSynthesizedRange = true;
      }
    }

    const upstream = await fetch(cdnUrl, {
      signal: compositeSignal,
      headers: upstreamHeaders,
    });

    // ── Headers received: cancel the 15s connection timeout ───────────────
    // Body streaming can now take as long as needed.
    // Client-disconnect monitoring remains active via compositeSignal.
    clearConnectionTimeout();

    if (!upstream.ok && upstream.status !== 206) {
      return jsonError(
        `Upstream returned ${upstream.status}. The link may have expired — please re-fetch.`,
        502,
      );
    }

    // ── Build response headers ─────────────────────────────────────────────
    const upstreamContentType = upstream.headers.get('content-type');
    const mimeType = upstreamContentType
      ? upstreamContentType.split(';')[0].trim()
      : audioOnly ? 'audio/mp4' : 'video/mp4';

    const responseHeaders = new Headers({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${filename}.${ext}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });

    // ── Range headers (pause/resume) ────────────────────────────────────────
    responseHeaders.set(
      'Accept-Ranges',
      upstream.headers.get('accept-ranges') ?? 'bytes',
    );
    const contentRange = upstream.headers.get('content-range');
    if (contentRange && !isSynthesizedRange) {
      responseHeaders.set('Content-Range', contentRange);
    }

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) responseHeaders.set('Content-Length', contentLength);

    // ── Pipe ReadableStream — ZERO disk writes ─────────────────────────────
    // Status mirrors upstream: 206 for partial (range), 200 for full / synthesized range.
    const responseStatus = isSynthesizedRange ? 200 : upstream.status;
    return new Response(upstream.body, {
      status: responseStatus,
      headers: responseHeaders,
    });

  } catch (err: unknown) {
    // Always clear timeout on error to avoid leaks
    clearConnectionTimeout();

    const message = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : '';

    // ── Distinguish error types for appropriate HTTP status ────────────────
    const isClientDisconnect =
      errorName === 'AbortError' &&
      (message.includes('Client disconnected') || req.signal.aborted);

    const isTimeout =
      errorName === 'TimeoutError' ||
      (errorName === 'AbortError' && message.includes('seconds'));

    if (isClientDisconnect) {
      // Client closed the connection — not our error, no need to log
      // Return 499 (Nginx convention for client-closed-request, not an official HTTP code)
      return jsonError('Download cancelled by client.', 499);
    }

    if (isTimeout) {
      console.warn(`[/api/stream] Connection timeout for: ${decodeURIComponent(url ?? '')}`);
      return jsonError(
        'The upstream server did not respond in time. Please try again.',
        504,
      );
    }

    console.error(`[/api/stream] Error (engine: ${engineType}):`, message);
    return jsonError('Failed to stream the media file. Please try re-fetching.', 500);
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
