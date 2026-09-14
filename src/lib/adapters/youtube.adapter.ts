import youtubeDl from 'youtube-dl-exec';
import { DownloaderAdapter, AdapterError, parseYtDlpError } from './types';
import {
  MediaMetadata,
  MediaFormatOption,
  AvailableFormat,
  SubtitleOption,
} from '@/types/media';
import { formatDuration, sanitizeFilename } from '@/lib/url-parser';
import fs from 'fs';
import path from 'path';

/**
 * Helper to format file sizes nicely from bytes.
 */
function formatBytes(bytes?: number, approx = false): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return 'Stream';
  const mb = bytes / (1024 * 1024);
  const prefix = approx ? '~' : '';
  if (mb >= 1024) return `${prefix}${(mb / 1024).toFixed(2)} GB`;
  return `${prefix}${mb.toFixed(1)} MB`;
}

function parseVideoCodec(vcodec?: string): string {
  if (!vcodec || vcodec === 'none') return '';
  const v = vcodec.toLowerCase();
  if (v.startsWith('av01') || v.includes('av1')) return 'AV1';
  if (v.startsWith('vp9') || v.startsWith('vp09')) return 'VP9';
  if (v.startsWith('avc') || v.includes('h264')) return 'H.264';
  if (v.startsWith('hev') || v.startsWith('hvc') || v.includes('h265')) return 'HEVC';
  return vcodec.split('.')[0].toUpperCase();
}

function parseAudioCodec(acodec?: string, defaultAudio?: string): string {
  if (!acodec || acodec === 'none') return defaultAudio || '';
  const a = acodec.toLowerCase();
  if (a.includes('mp4a') || a.includes('aac')) return 'AAC';
  if (a.includes('opus')) return 'Opus';
  if (a.includes('mp3')) return 'MP3';
  if (a.includes('flac')) return 'FLAC';
  return defaultAudio || 'AAC';
}

import { storeFormatInfo } from '@/lib/format-cache';

/**
 * YouTube adapter — uses yt-dlp with deep metadata extraction.
 */
export class YouTubeAdapter implements DownloaderAdapter {
  readonly platform = 'youtube' as const;

  async extract(url: string): Promise<MediaMetadata> {
    const cookieFile = path.join(process.cwd(), 'data', '.youtube-cookies.txt');
    const hasCookies = fs.existsSync(cookieFile);

    // ── Common yt-dlp options (Let yt-dlp negotiate modern headers natively) ──
    const commonOpts = {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
    };

    // ── PHASE 1: Attempt cascade ──────────────────────────────────────────
    const attempts = [
      // 1. Native yt-dlp routing with cookies (Extracts ALL DASH 144p - 4K+ formats)
      ...(hasCookies ? [{ ...commonOpts, cookies: cookieFile }] : []),
      // 2. Web client with cookies
      ...(hasCookies ? [{ ...commonOpts, extractorArgs: 'youtube:player_client=web', cookies: cookieFile }] : []),
      // 3. Native yt-dlp routing without cookies (Clean public videos)
      { ...commonOpts },
      // 4. Web client without cookies
      { ...commonOpts, extractorArgs: 'youtube:player_client=web' },
      // 5. Fallback for Made for Kids / BotGuard restricted videos (tv_embedded,web)
      ...(hasCookies ? [{ ...commonOpts, extractorArgs: 'youtube:player_client=tv_embedded,web', cookies: cookieFile }] : []),
      { ...commonOpts, extractorArgs: 'youtube:player_client=tv_embedded,web' },
    ];

    let raw: Record<string, unknown> | null = null;
    let lastError = '';

    for (const opts of attempts) {
      try {
        raw = (await youtubeDl(url, opts)) as Record<string, unknown>;
        if (raw && typeof raw === 'object') break; // success — stop cascade
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }
    }

    if (!raw || typeof raw !== 'object') {
      console.error('[YT-DLP RAW STDERR]:', lastError);
      throw parseYtDlpError(lastError, this.platform);
    }

    // Cache raw formats in memory for instantaneous /api/stream zero-latency streaming
    if (Array.isArray(raw.formats)) {
      storeFormatInfo(url, raw.formats);
    }

    const id = String(raw.id ?? '');
    const title = String(raw.title ?? 'Untitled Video');
    const thumbnail =
      String(raw.thumbnail ?? '') ||
      `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
    const duration = raw.duration ? formatDuration(Number(raw.duration)) : undefined;
    const durationSec = raw.duration ? Number(raw.duration) : 0;
    const author = raw.uploader ? String(raw.uploader) : undefined;
    const description = typeof raw.description === 'string' ? raw.description : undefined;

    // Determine default display quality
    const height = raw.height ? Number(raw.height) : null;
    const quality = height
      ? height > 720
        ? '720p'
        : `${height}p`
      : 'Best Available';

    // Build base /api/stream URLs
    const filename = sanitizeFilename(title);
    const streamUrl = `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube`;
    const audioUrl = `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&audioOnly=true`;

    // ── PHASE 2: Deep Extraction ──────────────────────────────────────────
    const rawFormats = Array.isArray(raw.formats)
      ? (raw.formats as Array<Record<string, unknown>>)
      : [];

    const availableFormats: AvailableFormat[] = [];
    const seenFormatKeys = new Set<string>();

    for (const f of rawFormats) {
      if (!f || typeof f !== 'object') continue;
      const formatId = f.format_id ? String(f.format_id) : '';
      if (!formatId) continue;

      const protocol = String(f.protocol ?? '');
      if (protocol.includes('m3u8') || protocol.includes('mhtml')) continue;

      const hasVideo = Boolean(f.vcodec && f.vcodec !== 'none');
      const hasAudio = Boolean(f.acodec && f.acodec !== 'none');
      if (!hasVideo && !hasAudio) continue; // Skip storyboard / images

      // Preserve exact file extension (mp4, webm, 3gp, m4a, etc.)
      const ext = String(f.ext ?? (hasAudio && !hasVideo ? 'm4a' : 'mp4')).toLowerCase();
      const h = f.height ? Number(f.height) : 0;
      const fps = f.fps ? Number(f.fps) : 0;
      const fpsStr = fps > 30 ? `${fps}` : '';
      const abr = f.abr ? Math.round(Number(f.abr)) : 0;
      const sizeStr = f.filesize
        ? formatBytes(Number(f.filesize), false)
        : f.filesize_approx
        ? formatBytes(Number(f.filesize_approx), true)
        : 'Stream';

      let type: 'video+audio' | 'video-only' | 'audio-only';
      let qualityStr = '';
      let requiresRender = false;

      const vCodecName = parseVideoCodec(f.vcodec ? String(f.vcodec) : '');
      const aCodecName = (hasVideo && hasAudio)
        ? parseAudioCodec(f.acodec ? String(f.acodec) : '', ext === 'webm' ? 'Opus' : 'AAC')
        : (ext === 'webm' ? 'Opus' : 'AAC');

      const codecLabel = vCodecName && aCodecName
        ? `${vCodecName} + ${aCodecName}`
        : (vCodecName || aCodecName || '');

      const formatVideoLabel = (height: number, fpsVal: number, extension: string, cLabel?: string) => {
        const fStr = fpsVal > 30 ? `${fpsVal}` : '';
        const cStr = cLabel ? ` (${cLabel})` : '';
        if (height >= 4320) return `8K (${height}p${fStr}) • ${extension.toUpperCase()}${cStr}`;
        if (height >= 2160) return `4K (${height}p${fStr}) • ${extension.toUpperCase()}${cStr}`;
        if (height >= 1440) return `2K (${height}p${fStr}) • ${extension.toUpperCase()}${cStr}`;
        if (height > 0) return `${height}p${fStr} • ${extension.toUpperCase()}${cStr}`;
        return `HD • ${extension.toUpperCase()}${cStr}`;
      };

      if (hasVideo && hasAudio) {
        type = 'video+audio';
        qualityStr = formatVideoLabel(h, fps, ext, codecLabel);
      } else if (hasVideo && !hasAudio) {
        type = 'video-only';
        requiresRender = true;
        qualityStr = formatVideoLabel(h, fps, ext, codecLabel);
      } else {
        // Skip adding raw single-connection audio formats from YouTube
        // Because YouTube throttles raw direct single connections to 28.8 KB/s!
        // All audio formats will be provided via dedicated high-speed chunked formats below.
        continue;
      }

      const dedupeKey = `${type}_${qualityStr}_${ext}_${sizeStr}`;
      if (seenFormatKeys.has(dedupeKey)) continue;
      seenFormatKeys.add(dedupeKey);

      const formatUrl = `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&formatId=${encodeURIComponent(formatId)}&ext=${encodeURIComponent(ext)}${requiresRender ? '&requiresRender=true' : ''}${durationSec ? `&duration=${durationSec}` : ''}`;

      availableFormats.push({
        id: formatId,
        ext,
        quality: qualityStr,
        type,
        size: sizeStr,
        formatUrl,
        requiresRender,
        height: h,
        fps,
        abr,
        isInstant: !requiresRender && ext !== 'mp3',
        vcodec: vCodecName || undefined,
        acodec: aCodecName || undefined,
        codecLabel: codecLabel || undefined,
      });
    }

    // Dedicated High-Speed Audio Options (Chunked Multi-Range Download + Fast Transcode)
    // Completely bypasses Google CDN single-connection throttling
    const calcAudioSize = (kbps: number) => {
      if (!durationSec) return 'Audio';
      const bytes = Math.round(((kbps * 1000) / 8) * durationSec);
      return formatBytes(bytes, false);
    };

    const dedicatedAudioFormats: AvailableFormat[] = [
      // ── M4A Native Stream Copy (Lossless AAC extraction) ──
      {
        id: 'm4a_original',
        ext: 'm4a',
        quality: 'M4A • 128 kbps (Original Audio)',
        type: 'audio-only',
        size: calcAudioSize(128),
        formatUrl: `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&formatId=m4a_original&bitrate=original&ext=m4a&audioOnly=true&requiresRender=true${durationSec ? `&duration=${durationSec}` : ''}`,
        requiresRender: true,
        abr: 128,
        isInstant: true,
        acodec: 'AAC',
        codecLabel: 'AAC 128k',
      },

      // ── MP3 Formats (High Speed LAME) ──
      {
        id: 'mp3_320',
        ext: 'mp3',
        quality: 'MP3 • 320 kbps (Studio Quality)',
        type: 'audio-only',
        size: calcAudioSize(320),
        formatUrl: `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&formatId=mp3_320&bitrate=320k&ext=mp3&audioOnly=true&requiresRender=true${durationSec ? `&duration=${durationSec}` : ''}`,
        requiresRender: true,
        abr: 320,
        isInstant: false,
        acodec: 'MP3',
        codecLabel: 'MP3 320k',
      },
      {
        id: 'mp3_192',
        ext: 'mp3',
        quality: 'MP3 • 192 kbps (Standard Quality)',
        type: 'audio-only',
        size: calcAudioSize(192),
        formatUrl: `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&formatId=mp3_192&bitrate=192k&ext=mp3&audioOnly=true&requiresRender=true${durationSec ? `&duration=${durationSec}` : ''}`,
        requiresRender: true,
        abr: 192,
        isInstant: false,
        acodec: 'MP3',
        codecLabel: 'MP3 192k',
      },
      {
        id: 'mp3_128',
        ext: 'mp3',
        quality: 'MP3 • 128 kbps (Compact)',
        type: 'audio-only',
        size: calcAudioSize(128),
        formatUrl: `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&formatId=mp3_128&bitrate=128k&ext=mp3&audioOnly=true&requiresRender=true${durationSec ? `&duration=${durationSec}` : ''}`,
        requiresRender: true,
        abr: 128,
        isInstant: false,
        acodec: 'MP3',
        codecLabel: 'MP3 128k',
      },

      // ── High Bitrate M4A & AAC Formats ──
      {
        id: 'm4a_320',
        ext: 'm4a',
        quality: 'M4A • 320 kbps (High Fidelity)',
        type: 'audio-only',
        size: calcAudioSize(128),
        formatUrl: `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&formatId=m4a_320&bitrate=original&ext=m4a&audioOnly=true&requiresRender=true${durationSec ? `&duration=${durationSec}` : ''}`,
        requiresRender: true,
        abr: 320,
        isInstant: true,
        acodec: 'AAC',
        codecLabel: 'AAC Original',
      },
      {
        id: 'aac_320',
        ext: 'aac',
        quality: 'AAC • 320 kbps (Raw Audio Stream)',
        type: 'audio-only',
        size: calcAudioSize(128),
        formatUrl: `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&formatId=aac_320&bitrate=original&ext=aac&audioOnly=true&requiresRender=true${durationSec ? `&duration=${durationSec}` : ''}`,
        requiresRender: true,
        abr: 320,
        isInstant: true,
        acodec: 'AAC',
        codecLabel: 'AAC ADTS',
      },

      // ── WEBM (Opus) Format ──
      {
        id: 'webm_160',
        ext: 'webm',
        quality: 'WEBM • 160 kbps (Opus Audio)',
        type: 'audio-only',
        size: calcAudioSize(160),
        formatUrl: `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&formatId=webm_160&bitrate=original&ext=webm&audioOnly=true&requiresRender=true${durationSec ? `&duration=${durationSec}` : ''}`,
        requiresRender: true,
        abr: 160,
        isInstant: true,
        acodec: 'Opus',
        codecLabel: 'Opus 160k',
      },
    ];
    availableFormats.push(...dedicatedAudioFormats);

    // Ensure at least one ready-to-play progressive video format exists
    if (!availableFormats.some((f) => f.type === 'video+audio')) {
      const estBytes = durationSec ? Math.round(durationSec * 220000) : 0;
      availableFormats.unshift({
        id: 'auto_progressive',
        ext: 'mp4',
        quality: `${quality} • MP4`,
        type: 'video+audio',
        size: estBytes > 0 ? formatBytes(estBytes, true) : 'Best Available',
        formatUrl: streamUrl,
        requiresRender: false,
        isInstant: true,
      });
    }

    // Ensure at least one audio format exists (fallback for progressive-only streams)
    if (!availableFormats.some((f) => f.type === 'audio-only')) {
      availableFormats.push({
        id: 'auto_audio',
        ext: 'm4a',
        quality: 'M4A • 320 kbps (High Fidelity)',
        type: 'audio-only',
        size: calcAudioSize(320),
        formatUrl: `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=youtube&formatId=m4a_320&bitrate=320k&ext=m4a&audioOnly=true&requiresRender=true${durationSec ? `&duration=${durationSec}` : ''}`,
        requiresRender: true,
        abr: 320,
        isInstant: false,
      });
    }

    // Sort availableFormats:
    // Video formats (highest resolution first: 8K -> 4K -> 2K -> 1080p -> 720p...)
    // Audio formats (M4A -> AAC -> MP3 -> WEBM, highest bitrate first)
    availableFormats.sort((a, b) => {
      const isVideoA = a.type === 'video+audio' || a.type === 'video-only';
      const isVideoB = b.type === 'video+audio' || b.type === 'video-only';
      if (isVideoA && !isVideoB) return -1;
      if (!isVideoA && isVideoB) return 1;

      if (isVideoA && isVideoB) {
        // 1. Highest resolution first (e.g. 4320 > 2160 > 1440 > 1080)
        const hA = a.height ?? 0;
        const hB = b.height ?? 0;
        if (hB !== hA) return hB - hA;

        // 2. Highest FPS first (e.g. 60fps > 30fps)
        const fpsA = a.fps ?? 0;
        const fpsB = b.fps ?? 0;
        if (fpsB !== fpsA) return fpsB - fpsA;

        // 3. Prefer MP4 container over WEBM if resolution and fps are equal
        if (a.ext === 'mp4' && b.ext !== 'mp4') return -1;
        if (a.ext !== 'mp4' && b.ext === 'mp4') return 1;

        return 0;
      }

      // For audio:
      // 1. Group by container priority (M4A first, then AAC, then MP3, then WEBM)
      const extPriority: Record<string, number> = { m4a: 4, aac: 3, mp3: 2, webm: 1 };
      const prioA = extPriority[a.ext] ?? 0;
      const prioB = extPriority[b.ext] ?? 0;
      if (prioB !== prioA) return prioB - prioA;

      // 2. Within the same container, sort highest bitrate first (320k > 256k > 192k > 128k)
      const abrA = a.abr ?? 0;
      const abrB = b.abr ?? 0;
      if (abrB !== abrA) return abrB - abrA;

      return 0;
    });

    // ── Parse Subtitles / Captions ─────────────────────────────────────────
    const subtitles: SubtitleOption[] = [];
    const rawSubs =
      raw.subtitles && typeof raw.subtitles === 'object'
        ? (raw.subtitles as Record<string, Array<{ ext?: string; url?: string; name?: string }>>)
        : {};
    const autoSubs =
      raw.automatic_captions && typeof raw.automatic_captions === 'object'
        ? (raw.automatic_captions as Record<string, Array<{ ext?: string; url?: string; name?: string }>>)
        : {};

    const combinedSubs = { ...autoSubs, ...rawSubs };
    for (const [lang, tracks] of Object.entries(combinedSubs)) {
      if (Array.isArray(tracks) && tracks.length > 0) {
        const track = tracks.find((t) => t.ext === 'vtt' || t.ext === 'srt') || tracks[0];
        if (track?.url) {
          const langLabel = track.name ? `${track.name} (${lang})` : lang.toUpperCase();
          subtitles.push({
            lang: langLabel,
            url: track.url,
          });
        }
      }
    }

    // Sort subtitles alphabetically
    subtitles.sort((a, b) => a.lang.localeCompare(b.lang));

    // Also populate legacy formats array for backward compatibility
    const formats: MediaFormatOption[] = availableFormats.map((f) => ({
      label: `${f.quality} (${f.size})`,
      url: f.formatUrl,
      type: f.type === 'audio-only' ? 'audio' : 'video',
      ext: f.ext,
      quality: f.quality,
      formatId: f.id,
      isVideoOnly: f.type === 'video-only',
      requiresRender: f.requiresRender,
      vcodec: f.vcodec,
      acodec: f.acodec,
      codecLabel: f.codecLabel,
    }));

    return {
      id,
      platform: this.platform,
      title,
      thumbnail,
      duration,
      author,
      description,
      downloadStrategy: 'stream',
      downloadUrl: streamUrl,
      audioUrl,
      quality,
      audioQuality: '128kbps',
      audioExtension: 'm4a',
      formats,
      availableFormats,
      subtitles,
    };
  }
}
