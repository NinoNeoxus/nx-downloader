import { Platform, EngineType } from '@/types/media';
import { DownloaderAdapter } from './types';
import { YouTubeAdapter } from './youtube.adapter';
import { TikTokAdapter } from './tiktok.adapter';
import { InstagramAdapter } from './instagram.adapter';
import { FacebookAdapter } from './facebook.adapter';

// ─── Engine Selection ──────────────────────────────────────────────────────

/**
 * Reads the DOWNLOADER_ENGINE environment variable to determine which
 * extraction backend to use.
 *
 * Valid values:
 *   'ytdlp'  (default) — yt-dlp binary via youtube-dl-exec
 *                         Requires: yt-dlp binary on PATH or in node_modules/.bin
 *                         Deploy on: VPS, Docker, local dev
 *
 *   'cobalt'           — Self-hosted Cobalt API instance
 *                         Requires: COBALT_API_URL + optional COBALT_API_KEY env vars
 *                         Deploy on: Vercel, any serverless platform
 *
 * Example .env.local:
 *   DOWNLOADER_ENGINE=cobalt
 *   COBALT_API_URL=https://your-cobalt.example.com
 *   COBALT_API_KEY=your-secret-key
 */
export function getEngineType(): EngineType {
  const raw = (process.env.DOWNLOADER_ENGINE ?? 'ytdlp').toLowerCase().trim();
  if (raw === 'cobalt') return 'cobalt';
  return 'ytdlp'; // default
}

// ─── yt-dlp Adapter Registry ───────────────────────────────────────────────

/**
 * Singleton yt-dlp adapters — instantiated once, reused across requests.
 * Each adapter encapsulates platform-specific yt-dlp format selection,
 * error parsing, and metadata normalization.
 */
const ytdlpAdapters: Record<Platform, DownloaderAdapter> = {
  youtube: new YouTubeAdapter(),
  tiktok: new TikTokAdapter(),
  instagram: new InstagramAdapter(),
  facebook: new FacebookAdapter(),
};

// ─── Cobalt Universal Adapter (lazy import to avoid binary check on Vercel) ──

/**
 * For the Cobalt engine, we create a thin adapter shim that delegates to
 * the CobaltEngine. This keeps the adapter interface uniform while avoiding
 * importing youtube-dl-exec when running in Cobalt mode.
 */
async function createCobaltAdapter(platform: Platform): Promise<DownloaderAdapter> {
  const { CobaltEngine } = await import('@/lib/engines/cobalt.engine');
  const engine = new CobaltEngine();

  return {
    platform,
    extract: (url: string) => engine.extractMetadata(url, platform),
  };
}

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * Returns the appropriate adapter for the given platform.
 *
 * - In 'ytdlp' mode (default): returns a platform-specific yt-dlp adapter.
 * - In 'cobalt' mode: returns a shim that delegates to the Cobalt REST engine.
 *
 * The adapter interface is identical in both cases — callers don't need to
 * know which engine is active.
 */
export async function getAdapter(platform: Platform): Promise<DownloaderAdapter> {
  const engine = getEngineType();

  if (engine === 'cobalt') {
    return createCobaltAdapter(platform);
  }

  return ytdlpAdapters[platform];
}

export { ytdlpAdapters };
export type { DownloaderAdapter };
