import { Platform } from '@/types/media';

// ─── Platform Detection Regexes ────────────────────────────────────────────

const PLATFORM_PATTERNS: Record<Platform, RegExp[]> = {
  youtube: [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([\w-]{11})/,
    /(?:https?:\/\/)?youtu\.be\/([\w-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([\w-]{11})/,
    /(?:https?:\/\/)?(?:m\.)?youtube\.com\/watch\?(?:.*&)?v=([\w-]{11})/,
  ],
  tiktok: [
    /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[\w.]+\/video\/\d+/,
    /(?:https?:\/\/)?vm\.tiktok\.com\/[\w]+/,
    /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/t\/[\w]+/,
    /(?:https?:\/\/)?(?:m\.)?tiktok\.com\/@[\w.]+\/video\/\d+/,
  ],
  instagram: [
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([\w-]+)/,
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/reels?\/([\w-]+)/,
  ],
  facebook: [
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/(?:watch\/?\?v=|[\w.]+\/videos\/)(\d+)/,
    /(?:https?:\/\/)?(?:www\.)?fb\.watch\/([\w]+)/,
    /(?:https?:\/\/)?(?:www\.)?facebook\.com\/reel\/(\d+)/,
  ],
};

/**
 * Detects which platform a URL belongs to.
 * Returns null if no platform matches.
 */
export function detectPlatform(url: string): Platform | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(trimmed))) {
      return platform as Platform;
    }
  }
  return null;
}

/**
 * Strict validation — ensures a URL is a valid HTTP/HTTPS URL
 * and belongs to a supported platform.
 */
export function validateUrl(url: string): { valid: boolean; platform: Platform | null; error?: string } {
  const trimmed = url.trim();

  if (!trimmed) {
    return { valid: false, platform: null, error: 'URL cannot be empty.' };
  }

  // Basic URL format check
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, platform: null, error: 'Only HTTP and HTTPS URLs are supported.' };
    }
  } catch {
    return { valid: false, platform: null, error: 'Invalid URL format.' };
  }

  const platform = detectPlatform(trimmed);
  if (!platform) {
    return {
      valid: false,
      platform: null,
      error: 'Platform not supported. Supported: YouTube, TikTok, Instagram, Facebook.',
    };
  }

  return { valid: true, platform };
}

/**
 * Sanitizes a string to be safe for use as a filename.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^\w\s-]/g, '') // remove special chars
    .replace(/\s+/g, '_')      // spaces → underscores
    .replace(/__+/g, '_')      // collapse multiple underscores
    .slice(0, 200)             // max 200 chars
    .trim();
}

/**
 * Formats raw duration in seconds to a human-readable string (e.g. "3:42").
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Parses duration from seconds number or string (e.g. "3:14:05", "12:34", "750") into total seconds.
 */
export function parseDurationToSeconds(val: string | number | null | undefined): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.max(0, Math.round(val));

  const str = String(val).trim();
  if (!str) return 0;

  // Handle "HH:MM:SS" or "MM:SS"
  if (str.includes(':')) {
    const parts = str.split(':').map((p) => parseFloat(p));
    if (parts.some((p) => isNaN(p))) return 0;
    if (parts.length === 3) {
      return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
    if (parts.length === 2) {
      return Math.round(parts[0] * 60 + parts[1]);
    }
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : Math.max(0, Math.round(parsed));
}

