import { MediaMetadata, Platform } from '@/types/media';

/**
 * Interface that all platform-specific downloader adapters must implement.
 * Each adapter is responsible for extracting metadata for its platform.
 */
export interface DownloaderAdapter {
  readonly platform: Platform;
  /**
   * Extracts normalized MediaMetadata from a given URL.
   * Must NOT write to disk. May call yt-dlp with --dump-json only.
   * @throws {AdapterError} on extraction failure.
   */
  extract(url: string): Promise<MediaMetadata>;
}

/**
 * Structured error thrown by adapters with a machine-readable code.
 */
export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PRIVATE_VIDEO'
      | 'NOT_FOUND'
      | 'GEO_BLOCKED'
      | 'AGE_RESTRICTED'
      | 'RATE_LIMITED'
      | 'EXTRACTION_FAILED'
      | 'UNSUPPORTED_FORMAT',
    public readonly platform: Platform,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

/**
 * Parses yt-dlp stderr to produce a user-friendly, safe error message.
 * NEVER leaks backend paths, admin routes, or developer terminology to the client.
 */
export function parseYtDlpError(stderr: string, platform: Platform): AdapterError {
  const msg = stderr.toLowerCase();

  if (
    msg.includes('no video formats found') ||
    msg.includes('requested format not available') ||
    msg.includes('requested format is not available')
  ) {
    return new AdapterError('No downloadable format was found for this media.', 'UNSUPPORTED_FORMAT', platform);
  }

  if (msg.includes('private video') || msg.includes('this video is private')) {
    return new AdapterError('This video is private and cannot be downloaded.', 'PRIVATE_VIDEO', platform);
  }

  // Bot, sign-in, or reload challenge — sanitized, no route or cookie leaks
  if (
    msg.includes('sign in to confirm') ||
    msg.includes('confirm you') ||
    msg.includes('bot') ||
    msg.includes('the page needs to be reloaded') ||
    msg.includes('use --cookies')
  ) {
    return new AdapterError(
      'This video is age-restricted, private, or requires authentication to view.',
      'AGE_RESTRICTED',
      platform,
    );
  }

  if (msg.includes('video unavailable') || msg.includes('not available') || msg.includes('404')) {
    return new AdapterError('This video is unavailable or has been removed.', 'NOT_FOUND', platform);
  }

  if (msg.includes('geo') || msg.includes('not available in your country')) {
    return new AdapterError('This video is geo-restricted and not available in your region.', 'GEO_BLOCKED', platform);
  }

  if (msg.includes('age') || msg.includes('sign in to confirm your age')) {
    return new AdapterError('This video is age-restricted and requires authentication to view.', 'AGE_RESTRICTED', platform);
  }

  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) {
    return new AdapterError('Too many requests. Please try again in a few moments.', 'RATE_LIMITED', platform);
  }

  return new AdapterError(
    'Unable to process this video link. The content may be unavailable or protected.',
    'EXTRACTION_FAILED',
    platform,
  );
}
