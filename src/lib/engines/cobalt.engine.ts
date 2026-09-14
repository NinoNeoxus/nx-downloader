import { MediaMetadata, Platform } from '@/types/media';
import { DownloadEngine, EngineError } from './types';
import { formatDuration, sanitizeFilename } from '@/lib/url-parser';

// ─── Cobalt API v7 Response Types ──────────────────────────────────────────

interface CobaltSuccessResponse {
  status: 'tunnel' | 'redirect';
  url: string;
  filename: string;
}

interface CobaltPickerResponse {
  status: 'picker';
  picker: Array<{ type: string; url: string; thumb?: string }>;
  audio?: string;
}

interface CobaltErrorResponse {
  status: 'error';
  error: {
    code: string;
    context?: { service?: string; limit?: number };
  };
}

type CobaltResponse = CobaltSuccessResponse | CobaltPickerResponse | CobaltErrorResponse;

// ─── Error Code Mapping ────────────────────────────────────────────────────

const COBALT_ERROR_MESSAGES: Record<string, string> = {
  'content.too_long': 'Video is too long to be processed.',
  'content.video.unavailable': 'This video is unavailable or has been removed.',
  'content.video.age_restricted': 'This video is age-restricted.',
  'content.video.private': 'This video is private and cannot be downloaded.',
  'api.rate_exceeded': 'Too many requests. Please try again in a moment.',
  'api.auth.jwt.missing': 'Cobalt instance requires authentication. Please configure COBALT_API_KEY.',
  'link.unsupported': 'This URL is not supported by the configured Cobalt instance.',
};

/**
 * Cobalt API Engine (v7) — calls a self-hosted or approved Cobalt instance.
 *
 * WHY COBALT FOR VERCEL:
 *   Cobalt is a pure HTTP REST API. No binary, no Python, no native modules.
 *   It runs entirely on the server side of the Cobalt instance — our Next.js
 *   app only makes HTTP fetch() calls, which work in any serverless environment.
 *
 * DEPLOYMENT REQUIREMENTS:
 *   You MUST host your own Cobalt instance:
 *   https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md
 *
 *   Set these environment variables:
 *     DOWNLOADER_ENGINE=cobalt
 *     COBALT_API_URL=https://your-cobalt-instance.com
 *     COBALT_API_KEY=your-api-key  (if your instance requires auth)
 *
 * NOTE: The public api.cobalt.tools instance has bot protection and is NOT
 *       intended for programmatic use — always self-host.
 */
export class CobaltEngine implements DownloadEngine {
  readonly type = 'cobalt' as const;

  private readonly apiUrl: string;
  private readonly apiKey?: string;

  constructor() {
    this.apiUrl = (process.env.COBALT_API_URL ?? '').replace(/\/$/, '');
    this.apiKey = process.env.COBALT_API_KEY;

    if (!this.apiUrl) {
      throw new EngineError(
        'COBALT_API_URL environment variable is not set. Please configure your self-hosted Cobalt instance URL.',
        'CONFIG_MISSING',
        'cobalt',
      );
    }
  }

  async extractMetadata(url: string, platform: Platform): Promise<MediaMetadata> {
    // ── Build request headers ──────────────────────────────────────────────
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Api-Key ${this.apiKey}`;
    }

    // ── Request video download URL from Cobalt ─────────────────────────────
    const videoRes = await fetch(`${this.apiUrl}/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        url,
        // Phase 1: max 720p — no ffmpeg merge for higher resolutions
        videoQuality: '720',
        audioFormat: 'best', // best = m4a/aac (no transcoding)
        downloadMode: 'auto',
        filenameStyle: 'basic',
        disableMetadata: false,
      }),
    });

    if (!videoRes.ok) {
      const text = await videoRes.text().catch(() => '');
      throw new EngineError(
        `Cobalt API returned HTTP ${videoRes.status}: ${text.slice(0, 200)}`,
        'HTTP_ERROR',
        'cobalt',
      );
    }

    const videoData = await videoRes.json() as CobaltResponse;

    // ── Request audio-only URL from Cobalt ────────────────────────────────
    let audioDownloadUrl: string | undefined;
    try {
      const audioRes = await fetch(`${this.apiUrl}/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url,
          audioFormat: 'best',
          downloadMode: 'audio',
          filenameStyle: 'basic',
          disableMetadata: true,
        }),
      });
      if (audioRes.ok) {
        const audioData = await audioRes.json() as CobaltResponse;
        if (audioData.status === 'tunnel' || audioData.status === 'redirect') {
          // Proxy audio through our /api/stream for consistent Content-Disposition
          const cobaltUrl = (audioData as CobaltSuccessResponse).url;
          const audioFilename = sanitizeFilename(url); // placeholder until we have title
          audioDownloadUrl = `/api/stream?url=${encodeURIComponent(cobaltUrl)}&filename=${encodeURIComponent(audioFilename)}&platform=${platform}&isCobaltUrl=true`;
        }
      }
    } catch {
      // Audio extraction is non-fatal — proceed without it
    }

    // ── Handle video response statuses ────────────────────────────────────
    if (videoData.status === 'error') {
      const errorData = videoData as CobaltErrorResponse;
      const code = errorData.error.code;
      const friendlyMessage = COBALT_ERROR_MESSAGES[code] ??
        `Cobalt could not process this URL (${code}).`;

      // Map Cobalt error codes to AdapterError codes
      const isPrivate = code.includes('private') || code.includes('age');
      const isNotFound = code.includes('unavailable');
      const isRateLimit = code.includes('rate');

      throw new EngineError(
        friendlyMessage,
        isPrivate ? 'PRIVATE_VIDEO' : isNotFound ? 'NOT_FOUND' : isRateLimit ? 'RATE_LIMITED' : 'EXTRACTION_FAILED',
        'cobalt',
      );
    }

    if (videoData.status === 'picker') {
      // Multi-item picker (e.g., Instagram carousel) — take the first video item
      const pickerData = videoData as CobaltPickerResponse;
      const firstVideo = pickerData.picker.find(item => item.type === 'video') ?? pickerData.picker[0];
      if (!firstVideo) {
        throw new EngineError('No downloadable item found in picker response.', 'EXTRACTION_FAILED', 'cobalt');
      }
      // Use the first item URL — Cobalt already handles proxying/tunneling
      const dlUrl = firstVideo.url;
      const filename = sanitizeFilename(`${platform}_video_${Date.now()}`);
      const downloadUrl = `/api/stream?url=${encodeURIComponent(dlUrl)}&filename=${encodeURIComponent(filename)}&platform=${platform}&isCobaltUrl=true`;

      return this.buildMetadata({
        platform,
        title: `${platform.charAt(0).toUpperCase() + platform.slice(1)} Video`,
        thumbnail: firstVideo.thumb ?? '',
        downloadUrl,
        audioUrl: audioDownloadUrl,
        quality: '720p',
      });
    }

    // status === 'tunnel' | 'redirect'
    const successData = videoData as CobaltSuccessResponse;
    const cobaltVideoUrl = successData.url;
    const filename = sanitizeFilename(
      successData.filename.replace(/\.[^.]+$/, '') // strip extension from Cobalt filename
    );

    // Proxy Cobalt's tunnel URL through our /api/stream for Content-Disposition control
    const downloadUrl = `/api/stream?url=${encodeURIComponent(cobaltVideoUrl)}&filename=${encodeURIComponent(filename)}&platform=${platform}&isCobaltUrl=true`;

    // Update audio URL with real filename
    if (audioDownloadUrl) {
      audioDownloadUrl = audioDownloadUrl.replace(
        /filename=[^&]*/,
        `filename=${encodeURIComponent(filename)}`,
      );
    }

    return this.buildMetadata({
      platform,
      title: filename.replace(/_/g, ' '),
      thumbnail: '',
      downloadUrl,
      audioUrl: audioDownloadUrl,
      quality: '720p',
    });
  }

  private buildMetadata(params: {
    platform: Platform;
    title: string;
    thumbnail: string;
    downloadUrl: string;
    audioUrl?: string;
    quality: string;
  }): MediaMetadata {
    return {
      id: `cobalt-${Date.now()}`,
      platform: params.platform,
      title: params.title,
      thumbnail: params.thumbnail,
      downloadStrategy: 'stream',
      downloadUrl: params.downloadUrl,
      audioUrl: params.audioUrl,
      quality: params.quality,
      audioQuality: '128kbps',
      audioExtension: 'm4a',
    };
  }
}

// Re-export formatDuration for use in cobalt engine
export { formatDuration };
