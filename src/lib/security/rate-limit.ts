/**
 * src/lib/security/rate-limit.ts
 *
 * Zero-dependency, in-memory, fixed-window rate limiter using a Map.
 *
 * Design decisions:
 *   - Fixed window (not sliding): simpler, O(1) per check, acceptable for Phase 1.
 *     Note: fixed windows can allow 2× burst at window boundaries — for a video
 *     downloader, this is an acceptable trade-off vs. Redis complexity.
 *   - Lazy cleanup: stale entries are purged in-band (no setInterval in module
 *     scope, which can cause issues with Next.js hot-reload and edge runtimes).
 *   - Memory bound: each entry is ~100 bytes; at 10K unique IPs/window = ~1 MB.
 *     The 5-minute cleanup interval keeps this bounded in production.
 *   - IP normalization: IPv6 addresses are truncated to /64 prefix to prevent
 *     trivial bypass by rotating the last 64 bits of the address.
 *
 * For production at scale, replace with Upstash Redis + @upstash/ratelimit
 * for distributed rate limiting across multiple server instances.
 */

import { NextRequest } from 'next/server';

// ─── Configuration ─────────────────────────────────────────────────────────

/** Maximum requests per IP within a single WINDOW_MS period. */
const MAX_REQUESTS = 15;

/** Rate limit window duration in milliseconds. */
const WINDOW_MS = 60_000; // 1 minute

/**
 * How often to run the lazy cleanup pass (in ms).
 * Cleanup removes all expired window records to prevent unbounded Map growth.
 */
const CLEANUP_INTERVAL_MS = 5 * 60_000; // every 5 minutes

// ─── Internal State ────────────────────────────────────────────────────────

interface WindowRecord {
  /** Number of requests made in the current window. */
  count: number;
  /** Unix timestamp (ms) when this window started. */
  windowStart: number;
}

/** The rate-limit store. Module-level singleton, survives across requests. */
const store = new Map<string, WindowRecord>();

/** Timestamp of the last cleanup pass. Prevents cleanup on every request. */
let lastCleanupAt = Date.now();

// ─── Result Type ───────────────────────────────────────────────────────────

export interface RateLimitResult {
  /** true = request is allowed; false = limit exceeded. */
  allowed: boolean;
  /** Requests remaining in this window (0 when denied). */
  remaining: number;
  /** Unix epoch seconds at which the current window resets. */
  resetAt: number;
  /**
   * Seconds the client should wait before retrying.
   * Only set when `allowed = false`.
   */
  retryAfter?: number;
}

// ─── IP Extraction ─────────────────────────────────────────────────────────

/**
 * Extracts the real client IP from a Next.js App Router request.
 *
 * Header priority (typical reverse-proxy chain):
 *   1. x-forwarded-for — set by CDN/load-balancer; may be comma-separated list.
 *      Take ONLY the first entry (leftmost = original client).
 *   2. x-real-ip       — set by Nginx; single IP value.
 *   3. Fallback        — '127.0.0.1' (only in local dev with no proxy).
 *
 * ⚠️  Security note: in production behind Vercel/Nginx/Cloudflare, these
 *     headers are set by the trusted reverse proxy. If your app is exposed
 *     directly to the internet (no proxy), an attacker could spoof these
 *     headers. Always deploy behind a trusted proxy.
 */
export function getClientIp(req: NextRequest): string {
  // Cloudflare Connecting IP (highest fidelity behind Cloudflare proxy)
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return normalizeIp(cfIp.trim());

  const xForwardedFor = req.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    // "client, proxy1, proxy2" → take only the leftmost (original client) IP
    const firstIp = xForwardedFor.split(',')[0]?.trim();
    if (firstIp) return normalizeIp(firstIp);
  }

  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp) return normalizeIp(xRealIp.trim());

  return '127.0.0.1';
}

export function getClientCountry(req: NextRequest): string | undefined {
  const country = req.headers.get('cf-ipcountry');
  return country && country !== 'XX' ? country.toUpperCase() : undefined;
}

/**
 * Normalizes an IP address for use as a Map key.
 *
 * For IPv6: truncates to the /64 network prefix to prevent bypass by
 * rotating the interface ID (last 64 bits), which is trivially possible
 * with many IPv6 ISP allocations.
 *
 * For IPv4: returns as-is (already a minimal identifier).
 */
function normalizeIp(ip: string): string {
  // IPv6 detection: contains colons
  if (ip.includes(':')) {
    // Take the first 4 groups (64-bit network prefix)
    const groups = ip.split(':');
    return groups.slice(0, 4).join(':') + '::';
  }
  return ip;
}

// ─── Cleanup ───────────────────────────────────────────────────────────────

/**
 * Removes all expired window records from the store.
 * Called lazily — at most once per CLEANUP_INTERVAL_MS.
 */
function cleanupExpiredRecords(now: number): void {
  store.forEach((record, ip) => {
    if (now - record.windowStart >= WINDOW_MS) {
      store.delete(ip);
    }
  });
}

// ─── Core Rate-Limit Check ─────────────────────────────────────────────────

/**
 * Checks and increments the rate limit for a given IP address.
 *
 * Algorithm (fixed window):
 *   1. If no record exists OR current window has expired: start a fresh window.
 *   2. If count >= MAX_REQUESTS: deny and return retry info.
 *   3. Otherwise: increment count and allow.
 *
 * @param ip - Normalized client IP address (from `getClientIp()`).
 * @returns RateLimitResult with `allowed`, `remaining`, `resetAt`, `retryAfter`.
 */
export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();

  // Lazy cleanup — prevents unbounded Map growth without setInterval
  if (now - lastCleanupAt >= CLEANUP_INTERVAL_MS) {
    cleanupExpiredRecords(now);
    lastCleanupAt = now;
  }

  const record = store.get(ip);
  const windowExpired = !record || now - record.windowStart >= WINDOW_MS;

  if (windowExpired) {
    // ── Start a fresh window ──────────────────────────────────────────────
    store.set(ip, { count: 1, windowStart: now });
    const resetAt = Math.ceil((now + WINDOW_MS) / 1000); // epoch seconds

    return {
      allowed: true,
      remaining: MAX_REQUESTS - 1,
      resetAt,
    };
  }

  // ── Within existing window ────────────────────────────────────────────────
  const resetAt = Math.ceil((record.windowStart + WINDOW_MS) / 1000);

  if (record.count >= MAX_REQUESTS) {
    // ── Limit exceeded ─────────────────────────────────────────────────────
    const retryAfter = Math.max(
      1,
      Math.ceil((record.windowStart + WINDOW_MS - now) / 1000),
    );

    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter,
    };
  }

  // ── Allow and increment ──────────────────────────────────────────────────
  record.count += 1;

  return {
    allowed: true,
    remaining: MAX_REQUESTS - record.count,
    resetAt,
  };
}

// ─── Response Helper ────────────────────────────────────────────────────────

/**
 * Builds the standard set of rate-limit response headers.
 *
 * Follows the IETF draft "RateLimit Header Fields for HTTP":
 * https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/
 */
export function buildRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(MAX_REQUESTS),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
  };

  if (!result.allowed && result.retryAfter !== undefined) {
    headers['Retry-After'] = String(result.retryAfter);
  }

  return headers;
}
