// ─── Shared Media Types ────────────────────────────────────────────────────

export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook';

export type DownloadStrategy = 'direct' | 'stream';

export type AppState = 'idle' | 'loading' | 'error' | 'success';

/**
 * Individual format entry available for download (progressive, video-only, or audio).
 */
export interface MediaFormatOption {
  label: string;
  url: string;
  type: 'video' | 'audio';
  ext: string;
  quality?: string;
  formatId?: string;
  filesize?: number;
  isVideoOnly?: boolean;
  requiresRender?: boolean;
  note?: string;
  vcodec?: string;
  acodec?: string;
  codecLabel?: string;
}

export interface AvailableFormat {
  id: string;
  ext: string;
  quality: string;
  type: 'video+audio' | 'video-only' | 'audio-only';
  size: string;
  formatUrl: string;
  requiresRender?: boolean;
  height?: number;
  fps?: number;
  abr?: number;
  isInstant?: boolean;
  vcodec?: string;
  acodec?: string;
  codecLabel?: string;
}

export interface SubtitleOption {
  lang: string;
  url: string;
}

/**
 * Normalized metadata returned from any platform adapter.
 * The `downloadUrl` is either a direct CDN URL (strategy: 'direct')
 * or an internal /api/stream endpoint URL (strategy: 'stream').
 */
export interface MediaMetadata {
  id: string;
  platform: Platform;
  title: string;
  thumbnail: string;
  duration?: string; // Human-readable e.g. "3:42"
  author?: string;
  description?: string;
  downloadStrategy: DownloadStrategy;
  /** For 'direct': raw CDN URL. For 'stream': /api/stream?url=...&filename=... */
  downloadUrl: string;
  /** Audio-only stream URL pointing to /api/stream with audioOnly=true */
  audioUrl?: string;
  /**
   * Best available progressive video quality (single-file, audio+video).
   * Phase 1 (no FFmpeg): max 720p for YouTube (DASH streams above 720p
   * have no audio and require server-side merging via FFmpeg).
   * Label examples: "720p", "Best Available".
   */
  quality?: string;
  /** Human-readable audio quality e.g. "128kbps" */
  audioQuality?: string;
  /**
   * Real audio file extension served by the server.
   * Phase 1 (no FFmpeg): 'm4a' or 'webm' — raw extracted audio stream.
   * Phase 2 (with FFmpeg): 'mp3' for transcoded output.
   */
  audioExtension?: 'm4a' | 'webm' | 'mp3';
  /** Available download formats (multi-quality options) */
  formats?: MediaFormatOption[];
  /** Deep extraction formats array categorized by stream capabilities */
  availableFormats?: AvailableFormat[];
  /** Subtitles / closed captions tracks */
  subtitles?: SubtitleOption[];
}

// ─── Engine Types ──────────────────────────────────────────────────────────

/**
 * Selects the underlying download extraction engine.
 * Set via the DOWNLOADER_ENGINE environment variable.
 *
 * - 'ytdlp'  : Use yt-dlp binary via youtube-dl-exec (local / VPS / Docker only)
 * - 'cobalt' : Use a self-hosted Cobalt API instance (Vercel-compatible, no binary)
 */
export type EngineType = 'ytdlp' | 'cobalt';

// ─── API Payload Types ─────────────────────────────────────────────────────

export interface ExtractRequest {
  url: string;
}

export type ExtractResponse =
  | { success: true; data: MediaMetadata }
  | { success: false; error: string; code: string };

export interface StreamParams {
  url: string;
  filename: string;
  mimeType?: string;
}
