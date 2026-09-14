import { MediaMetadata, Platform } from '@/types/media';

/**
 * Interface that all extraction ENGINE implementations must satisfy.
 * An engine is the low-level mechanism for resolving metadata + download URLs.
 *
 * Engines are separate from Adapters:
 *   - Adapter  : Platform-specific logic (URL patterns, field mapping, error parsing)
 *   - Engine   : Underlying extraction tool (yt-dlp binary vs. Cobalt REST API)
 *
 * This separation allows swapping the engine without changing adapter logic.
 */
export interface DownloadEngine {
  readonly type: 'ytdlp' | 'cobalt';

  /**
   * Extract metadata for a given URL.
   * Must NOT write anything to disk.
   */
  extractMetadata(url: string, platform: Platform): Promise<MediaMetadata>;
}

/**
 * Error thrown by an engine that includes a machine-readable reason code.
 */
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly engine: 'ytdlp' | 'cobalt',
  ) {
    super(message);
    this.name = 'EngineError';
  }
}
