import path from 'path';
import fs from 'fs';
import youtubeDl from 'youtube-dl-exec';
import { DownloaderAdapter, AdapterError, parseYtDlpError } from './types';
import { MediaMetadata, AvailableFormat } from '@/types/media';
import { formatDuration, sanitizeFilename } from '@/lib/url-parser';

/**
 * Instagram adapter — handles public posts, reels, and IGTV.
 * Strategy: 'stream' — Instagram CDN URLs have short-lived tokens, so we proxy
 * through /api/stream. Supports optional cookies from data/.instagram-cookies.txt.
 */
export class InstagramAdapter implements DownloaderAdapter {
  readonly platform = 'instagram' as const;

  async extract(url: string): Promise<MediaMetadata> {
    const cookieFile = path.join(process.cwd(), 'data', '.instagram-cookies.txt');
    const hasCookies = fs.existsSync(cookieFile);

    let raw: Record<string, unknown>;

    try {
      raw = (await youtubeDl(url, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        format: 'best[ext=mp4]/best',
        ...(hasCookies ? { cookies: cookieFile } : {}),
        addHeader: [
          'referer:https://www.instagram.com/',
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        ],
      })) as Record<string, unknown>;
    } catch (err: unknown) {
      const stderr = err instanceof Error ? err.message : String(err);

      if (
        stderr.includes('login required') ||
        stderr.includes('checkpoint required') ||
        stderr.includes('cookies') ||
        stderr.includes('not logged in') ||
        stderr.includes('rate-limit') ||
        stderr.includes('Requires authentication')
      ) {
        throw new AdapterError(
          'Instagram membatasi akses ini (perlu login). Silakan upload file cookies Instagram di Admin Panel (/admin) untuk membuka akses unduhan.',
          'PRIVATE_VIDEO',
          this.platform,
        );
      }
      throw parseYtDlpError(stderr, this.platform);
    }

    if (!raw || typeof raw !== 'object') {
      throw new AdapterError('Tidak ada respon data dari Instagram.', 'EXTRACTION_FAILED', this.platform);
    }

    const id = String(raw.id ?? Date.now().toString());
    const title = String(raw.title ?? raw.description ?? 'Instagram Video').slice(0, 100);
    const author = raw.uploader
      ? String(raw.uploader)
      : raw.channel
        ? String(raw.channel)
        : undefined;

    const thumbnails = raw.thumbnails as Array<{ url: string }> | undefined;
    const thumbnail =
      (thumbnails && thumbnails.length > 0
        ? thumbnails[thumbnails.length - 1].url
        : String(raw.thumbnail ?? '')) || '';

    const duration = raw.duration ? formatDuration(Number(raw.duration)) : undefined;
    const height = raw.height ? Number(raw.height) : null;
    const quality = height ? `${height}p` : 'Best Available';

    const filename = sanitizeFilename(title);
    const streamUrl = `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=instagram&ext=mp4`;
    const audioUrl = `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}_audio&platform=instagram&audioOnly=true&ext=m4a`;
    const mp3Url = `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}_audio&platform=instagram&audioOnly=true&ext=mp3&bitrate=320k`;

    const availableFormats: AvailableFormat[] = [
      {
        id: 'ig_video_best',
        ext: 'mp4',
        quality: `${quality} • MP4`,
        type: 'video+audio',
        size: 'Best Quality',
        formatUrl: streamUrl,
        requiresRender: false,
      },
      {
        id: 'ig_audio_m4a',
        ext: 'm4a',
        quality: '⚡ Audio M4A (128kbps AAC) • Instan',
        type: 'audio-only',
        size: 'Standard',
        formatUrl: audioUrl,
        requiresRender: false,
        isInstant: true,
      },
      {
        id: 'ig_audio_mp3',
        ext: 'mp3',
        quality: '⚙️ Audio MP3 (320kbps) • Konversi Server',
        type: 'audio-only',
        size: 'High Quality',
        formatUrl: mp3Url,
        requiresRender: true,
        isInstant: false,
      },
    ];

    return {
      id,
      platform: this.platform,
      title,
      thumbnail,
      duration,
      author,
      downloadStrategy: 'stream',
      downloadUrl: streamUrl,
      audioUrl,
      quality,
      audioQuality: '320kbps',
      audioExtension: 'mp3',
      availableFormats,
      formats: [
        {
          label: `${quality} Video (MP4)`,
          url: streamUrl,
          type: 'video',
          ext: 'mp4',
          quality,
        },
        {
          label: 'Audio Only (MP3)',
          url: mp3Url,
          type: 'audio',
          ext: 'mp3',
          quality: '320kbps',
        },
      ],
    };
  }
}
