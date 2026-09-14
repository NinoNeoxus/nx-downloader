/**
 * In-memory cache for raw formats extracted from YouTube.
 * Eliminates redundant yt-dlp calls between /api/extract and /api/stream,
 * providing instant download initiation and avoiding duplicate BotGuard challenges.
 */

export interface CachedFormat {
  format_id: string;
  url: string;
  http_headers?: Record<string, string>;
  vcodec?: string;
  acodec?: string;
  ext?: string;
  abr?: number;
  height?: number;
  filesize?: number;
  filesize_approx?: number;
}

interface CacheEntry {
  formats: CachedFormat[];
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (signed URLs typically valid 6 hours)
const formatMap = new Map<string, CacheEntry>();

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const v = parsed.searchParams.get('v');
    if (v) return v;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  } catch {}
  return url.trim().toLowerCase();
}

export function storeFormatInfo(url: string, formats: unknown[]): void {
  if (!url || !Array.isArray(formats) || formats.length === 0) return;
  const key = normalizeUrlKey(url);
  const validFormats: CachedFormat[] = [];

  for (const f of formats) {
    if (!f || typeof f !== 'object') continue;
    const item = f as Record<string, unknown>;
    const formatId = item.format_id ? String(item.format_id) : '';
    const streamUrl = item.url ? String(item.url) : '';
    if (!formatId || !streamUrl) continue;

    validFormats.push({
      format_id: formatId,
      url: streamUrl,
      http_headers: (item.http_headers as Record<string, string>) || undefined,
      vcodec: item.vcodec ? String(item.vcodec) : undefined,
      acodec: item.acodec ? String(item.acodec) : undefined,
      ext: item.ext ? String(item.ext) : undefined,
      abr: typeof item.abr === 'number' ? item.abr : undefined,
      height: typeof item.height === 'number' ? item.height : undefined,
      filesize: typeof item.filesize === 'number' ? item.filesize : undefined,
      filesize_approx: typeof item.filesize_approx === 'number' ? item.filesize_approx : undefined,
    });
  }

  if (validFormats.length > 0) {
    formatMap.set(key, {
      formats: validFormats,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
}

export function getFormatInfo(url: string): CachedFormat[] | null {
  if (!url) return null;
  const key = normalizeUrlKey(url);
  const entry = formatMap.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    formatMap.delete(key);
    return null;
  }

  return entry.formats;
}

export function deleteFormatInfo(url: string): void {
  if (!url) return;
  const key = normalizeUrlKey(url);
  formatMap.delete(key);
}
