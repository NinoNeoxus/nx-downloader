import youtubeDl from 'youtube-dl-exec';
import { DownloaderAdapter, AdapterError, parseYtDlpError } from './types';
import { MediaMetadata } from '@/types/media';
import { formatDuration, sanitizeFilename } from '@/lib/url-parser';

/**
 * Facebook adapter — handles public Facebook videos, Watch content, and Reels.
 * Strategy: 'stream' — Facebook CDN URLs require proper Referer/User-Agent
 * headers and may expire; proxying ensures headers are always correct.
 *
 * ── SCOPE ──────────────────────────────────────────────────────────────────
 * Supported:   Public videos, Watch tab videos, public Reels
 * Unsupported: Friends-only, Group-only, Login-gated, or Private content
 *
 * ── AUDIO (Phase 1) ────────────────────────────────────────────────────────
 * Audio is extracted as raw M4A/AAC stream — no ffmpeg transcoding.
 */
export class FacebookAdapter implements DownloaderAdapter {
  readonly platform = 'facebook' as const;

  async extract(url: string): Promise<MediaMetadata> {
    let raw: Record<string, unknown>;

    try {
      raw = await youtubeDl(url, {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        format: 'best[ext=mp4]/best',
        addHeader: [
          'referer:https://www.facebook.com/',
          'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ],
      }) as Record<string, unknown>;
    } catch (err: unknown) {
      const stderr = err instanceof Error ? err.message : String(err);

      // ── Facebook-specific authentication errors ─────────────────────────
      // Facebook aggressively redirects to login for most protected content.
      if (
        stderr.includes('login') ||
        stderr.includes('checkpoint') ||
        stderr.includes('friends only') ||
        stderr.includes('You must be logged in') ||
        stderr.includes('Unsupported URL') ||
        stderr.includes('cookies')
      ) {
        throw new AdapterError(
          'Konten ini membutuhkan login atau bersifat privat (hanya teman/grup). Hanya video publik Facebook yang dapat diunduh tanpa autentikasi.',
          'PRIVATE_VIDEO',
          this.platform,
        );
      }
      throw parseYtDlpError(stderr, this.platform);
    }

    if (!raw || typeof raw !== 'object') {
      throw new AdapterError('No metadata returned from yt-dlp.', 'EXTRACTION_FAILED', this.platform);
    }

    const id = String(raw.id ?? Date.now().toString());
    const title = String(raw.title ?? raw.description ?? 'Facebook Video').slice(0, 100);
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
    const streamUrl = `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=facebook`;
    const audioUrl = `/api/stream?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&platform=facebook&audioOnly=true`;

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
      audioQuality: '128kbps',
      audioExtension: 'm4a',
      formats: [
        {
          label: `${quality} Video (MP4)`,
          url: streamUrl,
          type: 'video',
          ext: 'mp4',
          quality,
        },
        {
          label: 'Audio Only (M4A)',
          url: audioUrl,
          type: 'audio',
          ext: 'm4a',
          quality: '128kbps',
        },
      ],
    };
  }
}
