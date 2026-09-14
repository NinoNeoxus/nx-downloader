/**
 * src/lib/validation/url-schema.ts
 *
 * SSRF-hardened URL validation + tracking-param sanitizer.
 *
 * Security layers applied in order:
 *   1. Zod: syntactic validation (length, URL format)
 *   2. Protocol enforcement (http/https only — blocks file://, ftp://, etc.)
 *   3. Private/internal IP blocklist (SSRF protection)
 *   4. Domain allowlist (only known social platforms accepted)
 *   5. Tracking parameter stripping (privacy + cache optimisation)
 */

import { z } from 'zod';
import { Platform } from '@/types/media';

// ─── 1. Private / Internal Network Blocklist (SSRF Protection) ─────────────
//
// If a user supplies a URL that resolves to an internal host, yt-dlp or our
// `fetch()` in /api/stream would silently make requests to that internal host
// — potentially hitting AWS/GCP metadata endpoints, internal dashboards, etc.
//
// We block at the hostname level BEFORE any DNS resolution.

/** IPv4 private/loopback/link-local ranges that must never be fetched. */
const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^127\./,                                    // 127.0.0.0/8  loopback
  /^10\./,                                     // 10.0.0.0/8   RFC 1918 class A
  /^172\.(1[6-9]|2\d|3[01])\./,              // 172.16.0.0/12 RFC 1918 class B
  /^192\.168\./,                               // 192.168.0.0/16 RFC 1918 class C
  /^169\.254\./,                               // 169.254.0.0/16 link-local (⚠️ AWS/GCP/Azure metadata!)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 CGNAT
  /^0\./,                                      // 0.0.0.0/8    "this" network
  /^198\.51\.100\./,                           // RFC 5737 documentation range
  /^203\.0\.113\./,                            // RFC 5737 documentation range
];

/** IPv6 private/loopback/link-local addresses that must never be fetched. */
const PRIVATE_IPV6_PATTERNS: RegExp[] = [
  /^::1$/i,                     // ::1/128   IPv6 loopback
  /^\[::1\]$/i,                 // [::1]     bracketed loopback (in URLs)
  /^fc[0-9a-f]{2}:/i,           // fc00::/7  unique-local (private)
  /^fd[0-9a-f]{2}:/i,           // fd00::/8  unique-local (private)
  /^fe[89ab][0-9a-f]:/i,        // fe80::/10 link-local
  /^\[fe[89ab][0-9a-f]/i,       // bracketed link-local in URLs
];

/**
 * Exact hostnames that are always blocked regardless of IP pattern matching.
 * Includes cloud provider metadata endpoints — critical SSRF targets.
 */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  'metadata.google.internal',  // GCP metadata service
  'metadata.internal',          // GCP alias
  '169.254.169.254',           // AWS IMDSv1 / Azure IMDS / GCP legacy
  'fd00:ec2::254',              // AWS IMDSv2 IPv6
  '::1',                        // IPv6 loopback (bare)
]);

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  if (BLOCKED_HOSTNAMES.has(normalized)) return true;

  // Check IPv4 private ranges
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }

  // Check IPv6 private ranges
  for (const pattern of PRIVATE_IPV6_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }

  return false;
}

// ─── 2. Domain Allowlist ────────────────────────────────────────────────────
//
// We use suffix-matching so that all valid subdomains are accepted:
//   youtube.com → www.youtube.com, m.youtube.com ✅
//                 evil-youtube.com ❌ (does not end with .youtube.com)

const ALLOWED_DOMAIN_SUFFIXES: ReadonlyArray<string> = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'instagram.com',
  'facebook.com',
  'fb.watch',
];

function isAllowedDomain(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return ALLOWED_DOMAIN_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

// ─── 3. Platform Detection from Hostname ────────────────────────────────────

const HOSTNAME_TO_PLATFORM: Array<[string, Platform]> = [
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['tiktok.com', 'tiktok'],
  ['instagram.com', 'instagram'],
  ['facebook.com', 'facebook'],
  ['fb.watch', 'facebook'],
];

function detectPlatformFromHostname(hostname: string): Platform | null {
  const normalized = hostname.toLowerCase();
  for (const [suffix, platform] of HOSTNAME_TO_PLATFORM) {
    if (normalized === suffix || normalized.endsWith(`.${suffix}`)) {
      return platform;
    }
  }
  return null;
}

// ─── 4. Tracking Parameter Allowlists ──────────────────────────────────────
//
// Strategy: strip everything EXCEPT known-essential parameters.
// This is safer than a blocklist (new trackers emerge constantly).
// Using allowlist-per-platform means we only keep what we know is needed.

/**
 * Parameters explicitly preserved per platform.
 * Everything NOT in this set is treated as a tracking parameter and stripped.
 */
const PRESERVED_PARAMS: Record<Platform, ReadonlySet<string>> = {
  youtube: new Set([
    'v',      // video ID — required: youtube.com/watch?v=...
    't',      // timestamp — legitimate user intent (start at X seconds)
    'list',   // playlist — sometimes needed to identify the video in context
  ]),
  tiktok: new Set([]),   // TikTok IDs are always in the path — no essential params
  instagram: new Set([]), // Instagram IDs are always in the path
  facebook: new Set(['v']), // facebook.com/watch/?v=<id>
};

/**
 * Strips all query parameters that are NOT in the platform's allowlist.
 * Returns a cleaned URL string.
 *
 * Examples:
 *   youtube.com/watch?v=abc123&si=TRACKING&utm_source=share
 *   → youtube.com/watch?v=abc123
 *
 *   instagram.com/reel/ABC/?igshid=TRACKING&utm_source=ig_web
 *   → instagram.com/reel/ABC/
 */
function stripTrackingParams(parsedUrl: URL, platform: Platform): URL {
  const preserved = PRESERVED_PARAMS[platform] ?? new Set<string>();
  const cleaned = new URL(parsedUrl.toString());
  const keysToDelete: string[] = [];

  for (const key of cleaned.searchParams.keys()) {
    if (!preserved.has(key)) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    cleaned.searchParams.delete(key);
  }

  return cleaned;
}

// ─── 5. Composite Validation Result ─────────────────────────────────────────

export interface UrlValidationResult {
  /** Cleaned URL with tracking params removed — safe to pass to adapters. */
  cleanedUrl: string;
  /** Detected platform. */
  platform: Platform;
}

export interface UrlValidationError {
  error: string;
  /** Machine-readable code for structured error responses. */
  code:
    | 'EMPTY_URL'
    | 'URL_TOO_LONG'
    | 'INVALID_FORMAT'
    | 'UNSAFE_PROTOCOL'
    | 'SSRF_BLOCKED'
    | 'DOMAIN_NOT_ALLOWED';
}

export type UrlValidationOutcome =
  | ({ success: true } & UrlValidationResult)
  | ({ success: false } & UrlValidationError);

// ─── 6. Zod Shape Schema (structural validation only) ───────────────────────

export const UrlInputSchema = z.object({
  url: z
    .string({ required_error: 'URL is required.' })
    .min(1, 'URL cannot be empty.')
    .max(200, 'URL must be 200 characters or fewer.')
    .trim(),
});

export type UrlInput = z.infer<typeof UrlInputSchema>;

// ─── 7. Master Validation Function ──────────────────────────────────────────

/**
 * Validates, SSRF-checks, domain-allows, and de-tracks a user-supplied URL.
 *
 * This is the single security gate that all user-provided URLs must pass
 * before being handed to any adapter or engine.
 *
 * @param rawUrl - The raw URL string from the user's request body.
 * @returns A discriminated union: `{ success: true, cleanedUrl, platform }` or
 *          `{ success: false, error, code }`.
 */
export function validateAndCleanUrl(rawUrl: string): UrlValidationOutcome {
  // ── Guard: length (cheap check before parsing) ──────────────────────────
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    return { success: false, error: 'URL cannot be empty.', code: 'EMPTY_URL' };
  }
  if (trimmed.length > 200) {
    return { success: false, error: 'URL must be 200 characters or fewer.', code: 'URL_TOO_LONG' };
  }

  // ── Parse ────────────────────────────────────────────────────────────────
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      success: false,
      error: 'Invalid URL format. Please paste a complete video URL (e.g. https://youtube.com/watch?v=...).',
      code: 'INVALID_FORMAT',
    };
  }

  // ── Protocol check ───────────────────────────────────────────────────────
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      success: false,
      error: `Protocol "${parsed.protocol.replace(':', '')}" is not allowed. Only HTTP and HTTPS URLs are accepted.`,
      code: 'UNSAFE_PROTOCOL',
    };
  }

  // ── SSRF: Private/internal host check ────────────────────────────────────
  if (isPrivateHost(parsed.hostname)) {
    // Do NOT reveal internal network topology in the error message.
    return {
      success: false,
      error: 'This URL is not allowed. Please paste a valid public video URL.',
      code: 'SSRF_BLOCKED',
    };
  }

  // ── Domain allowlist ─────────────────────────────────────────────────────
  if (!isAllowedDomain(parsed.hostname)) {
    return {
      success: false,
      error:
        `Domain "${parsed.hostname}" is not supported. ` +
        'Supported platforms: YouTube, TikTok, Instagram, Facebook.',
      code: 'DOMAIN_NOT_ALLOWED',
    };
  }

  // ── Detect platform ───────────────────────────────────────────────────────
  const platform = detectPlatformFromHostname(parsed.hostname);
  if (!platform) {
    return {
      success: false,
      error: 'Could not determine the platform from this URL.',
      code: 'DOMAIN_NOT_ALLOWED',
    };
  }

  // ── Strip tracking parameters ─────────────────────────────────────────────
  const cleanedParsed = stripTrackingParams(parsed, platform);
  const cleanedUrl = cleanedParsed.toString();

  return { success: true, cleanedUrl, platform };
}
