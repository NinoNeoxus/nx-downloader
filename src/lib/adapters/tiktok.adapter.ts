import path from 'path';
import fs from 'fs';
import youtubeDl from 'youtube-dl-exec';
import { DownloaderAdapter, AdapterError, parseYtDlpError } from './types';
import { MediaMetadata, AvailableFormat } from '@/types/media';
import { formatDuration, sanitizeFilename } from '@/lib/url-parser';

/**
 * TikTok adapter — resilient dual-engine extractor.
 * 1. Primary: Direct TikWM High-Speed API (No watermark, HD MP4 + MP3, bypasses IP blocks)
 * 2. Fallback: yt-dlp with optional cookies support (data/.tiktok-cookies.txt)
 */
export class TikTokAdapter implements DownloaderAdapter {
  readonly platform = 'tiktok' as const;

  /**
   * Resolves shortlinks (vt.tiktok.com / vm.tiktok.com) to the full canonical URL.
   */
  private async resolveCanonicalUrl(rawUrl: string): Promise<string> {
    if (!rawUrl.includes('vt.tiktok.com') && !rawUrl.includes('vm.tiktok.com')) {
      return rawUrl;
    }
    try {
      const res = await fetch(rawUrl, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      });
      if (res.url && res.url.includes('/video/')) {
        return res.url;
      }
    } catch {}
    return rawUrl;
  }

  async extract(rawUrl: string): Promise<MediaMetadata> {
    const canonicalUrl = await this.resolveCanonicalUrl(rawUrl);

    // ── Primary Engine: TikWM API ──────────────────────────────────────────
    try {
      const res = await fetch('https://www.tikwm.com/api/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: canonicalUrl, web: '1', hd: '1' }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json && json.code === 0 && json.data) {
          const d = json.data;
          const baseHost = 'https://www.tikwm.com';
          const playUrl = d.play
            ? d.play.startsWith('http')
              ? d.play
              : `${baseHost}${d.play}`
            : '';
          const hdUrl = d.hdplay
            ? d.hdplay.startsWith('http')
              ? d.hdplay
              : `${baseHost}${d.hdplay}`
            : playUrl;
          const musicUrl = d.music
            ? d.music.startsWith('http')
              ? d.music
              : `${baseHost}${d.music}`
            : '';

          const id = String(d.id || Date.now());
          const title = String(d.title || 'TikTok Video');
          const author = d.author?.nickname || d.author?.unique_id || 'TikTok Creator';
          const thumbnail = d.cover
            ? d.cover.startsWith('http')
              ? d.cover
              : `${baseHost}${d.cover}`
            : '';
          const duration = d.duration
            ? `${Math.floor(d.duration / 60)}:${String(d.duration % 60).padStart(2, '0')}`
            : undefined;

          const filename = sanitizeFilename(title);
          const chosenVideoUrl = hdUrl || playUrl;

          // Stream through /api/stream with isDirectUrl=true so stream route directly proxies the media stream
          const downloadUrl = `/api/stream?url=${encodeURIComponent(chosenVideoUrl)}&isDirectUrl=true&filename=${encodeURIComponent(filename)}&platform=tiktok&ext=mp4`;
          const audioDownloadUrl = musicUrl
            ? `/api/stream?url=${encodeURIComponent(musicUrl)}&isDirectUrl=true&filename=${encodeURIComponent(filename)}_audio&platform=tiktok&audioOnly=true&ext=mp3`
            : `/api/stream?url=${encodeURIComponent(chosenVideoUrl)}&isDirectUrl=true&filename=${encodeURIComponent(filename)}_audio&platform=tiktok&audioOnly=true&ext=mp3`;

          const sizeMb = d.size ? `${(d.size / (1024 * 1024)).toFixed(1)} MB` : 'HD';

          const availableFormats: AvailableFormat[] = [
            {
              id: 'tiktok_hd_video',
              ext: 'mp4',
              quality: 'HD (Tanpa Watermark)',
              type: 'video+audio',
              size: sizeMb,
              formatUrl: downloadUrl,
              requiresRender: false,
            },
          ];

          if (playUrl && playUrl !== hdUrl) {
            const playDownloadUrl = `/api/stream?url=${encodeURIComponent(playUrl)}&isDirectUrl=true&filename=${encodeURIComponent(filename)}&platform=tiktok&ext=mp4`;
            availableFormats.push({
              id: 'tiktok_sd_video',
              ext: 'mp4',
              quality: 'Fast Video (Tanpa Watermark)',
              type: 'video+audio',
              size: 'Fast Download',
              formatUrl: playDownloadUrl,
              requiresRender: false,
            });
          }

          availableFormats.push({
            id: 'tiktok_audio',
            ext: 'mp3',
            quality: 'Original Audio (MP3)',
            type: 'audio-only',
            size: 'Audio Track',
            formatUrl: audioDownloadUrl,
            requiresRender: false,
          });

          return {
            id,
            platform: this.platform,
            title,
            thumbnail,
            duration,
            author,
            downloadStrategy: 'stream',
            downloadUrl,
            audioUrl: audioDownloadUrl,
            quality: 'HD',
            audioQuality: '192kbps',
            audioExtension: 'mp3',
            availableFormats,
            formats: [
              {
                label: 'HD Video (No Watermark)',
                url: downloadUrl,
                type: 'video',
                ext: 'mp4',
                quality: 'HD',
              },
              {
                label: 'Audio Only (MP3)',
                url: audioDownloadUrl,
                type: 'audio',
                ext: 'mp3',
                quality: '192kbps',
              },
            ],
          };
        }
      }
    } catch {
      // TikWM failed — proceed to yt-dlp fallback
    }

    // ── Fallback Engine: yt-dlp ────────────────────────────────────────────
    const cookieFile = path.join(process.cwd(), 'data', '.tiktok-cookies.txt');
    const hasCookies = fs.existsSync(cookieFile);

    let raw: Record<string, unknown>;
    try {
      raw = (await youtubeDl(canonicalUrl, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        format: 'best[ext=mp4]/best',
        ...(hasCookies ? { cookies: cookieFile } : {}),
        addHeader: [
          'referer:https://www.tiktok.com/',
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        ],
      })) as Record<string, unknown>;
    } catch (err: unknown) {
      const stderr = err instanceof Error ? err.message : String(err);
      if (stderr.includes('blocked') || stderr.includes('captcha')) {
        throw new AdapterError(
          'TikTok memblokir permintaan server. Silakan upload cookies TikTok di Admin Panel (/admin) untuk membuka akses.',
          'RATE_LIMITED',
          this.platform
        );
      }
      throw parseYtDlpError(stderr, this.platform);
    }

    if (!raw || typeof raw !== 'object') {
      throw new AdapterError('Tidak ada metadata dari TikTok.', 'EXTRACTION_FAILED', this.platform);
    }

    const id = String(raw.id ?? Date.now().toString());
    const title = String(raw.title ?? raw.description ?? 'TikTok Video');
    const author = raw.uploader ? String(raw.uploader) : raw.creator ? String(raw.creator) : undefined;

    const thumbnails = raw.thumbnails as Array<{ url: string; width?: number }> | undefined;
    const thumbnail =
      (thumbnails && thumbnails.length > 0
        ? thumbnails[thumbnails.length - 1].url
        : String(raw.thumbnail ?? '')) || '';

    const duration = raw.duration ? formatDuration(Number(raw.duration)) : undefined;

    const formats = raw.formats as
      | Array<{ url: string; ext?: string; vcodec?: string; acodec?: string; height?: number }>
      | undefined;
    let directUrl = String(raw.url ?? '');
    let quality = 'Best';

    if (formats && formats.length > 0) {
      const videoFormats = formats
        .filter((f) => f.vcodec && f.vcodec !== 'none' && f.url)
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

      if (videoFormats.length > 0) {
        directUrl = videoFormats[0].url;
        quality = videoFormats[0].height ? `${videoFormats[0].height}p` : 'Best';
      }
    }

    if (!directUrl) {
      throw new AdapterError('Gagal mengambil URL video TikTok.', 'EXTRACTION_FAILED', this.platform);
    }

    const filename = sanitizeFilename(title);
    const downloadUrl = `/api/stream?url=${encodeURIComponent(directUrl)}&isDirectUrl=true&filename=${encodeURIComponent(filename)}&platform=tiktok&ext=mp4`;
    const audioUrl = `/api/stream?url=${encodeURIComponent(directUrl)}&isDirectUrl=true&filename=${encodeURIComponent(filename)}_audio&platform=tiktok&audioOnly=true&ext=mp3`;

    return {
      id,
      platform: this.platform,
      title,
      thumbnail,
      duration,
      author,
      downloadStrategy: 'stream',
      downloadUrl,
      audioUrl,
      quality,
      audioQuality: '128kbps',
      audioExtension: 'mp3',
      availableFormats: [
        {
          id: 'tiktok_video',
          ext: 'mp4',
          quality: `${quality} • MP4`,
          type: 'video+audio',
          size: 'Best Quality',
          formatUrl: downloadUrl,
          requiresRender: false,
        },
        {
          id: 'tiktok_audio',
          ext: 'mp3',
          quality: 'Original Audio • MP3',
          type: 'audio-only',
          size: 'Audio',
          formatUrl: audioUrl,
          requiresRender: false,
        },
      ],
      formats: [
        {
          label: `${quality} Video (No Watermark)`,
          url: downloadUrl,
          type: 'video',
          ext: 'mp4',
          quality,
        },
        {
          label: 'Audio Only (MP3)',
          url: audioUrl,
          type: 'audio',
          ext: 'mp3',
          quality: '128kbps',
        },
      ],
    };
  }
}
