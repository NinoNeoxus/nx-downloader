/** @type {import('next').NextConfig} */

// ─── Security Headers (Pillar 4) ──────────────────────────────────────────
//
// Applied globally to ALL routes via the `headers()` config.
// These headers mirror what Helmet.js provides in Express — but natively
// in Next.js with zero additional dependencies.

/**
 * Content Security Policy.
 *
 * Key directives:
 *
 *   frame-ancestors 'none'
 *     Prevents ANY site (including same-origin) from embedding this app in
 *     an <iframe>. Blocks clickjacking completely.
 *     Note: 'none' is stricter than 'self' — we have no legitimate use case
 *     for embedding this tool in iframes, so 'none' is correct here.
 *
 *   default-src 'self'
 *     All resource types default to same-origin only.
 *
 *   script-src 'self' 'unsafe-inline'
 *     'unsafe-inline' is required by Next.js 14 App Router for inline
 *     hydration scripts. Phase 2 upgrade: replace with nonce-based CSP
 *     via Next.js Middleware for a stricter policy.
 *
 *   style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
 *     Tailwind CSS generates inline styles; Google Fonts loads stylesheets.
 *
 *   img-src 'self' data: blob: https:
 *     Thumbnails are served from arbitrary CDN hostnames — 'https:' is
 *     broad but necessary. Restricting to exact CDN hostnames is fragile
 *     (CDN domains change). The `images.remotePatterns` config handles
 *     Next.js image optimisation; this CSP covers raw <img> tags.
 *
 *   connect-src 'self'
 *     XHR/fetch calls are restricted to same-origin (our own API).
 *
 *   object-src 'none'
 *     Blocks Flash, Java plugins — vectors for old-school attacks.
 *
 *   base-uri 'self'
 *     Prevents attackers from injecting a <base> tag to redirect relative URLs.
 *
 *   form-action 'self'
 *     Restricts form submissions to same origin (prevents form hijacking).
 *
 *   upgrade-insecure-requests
 *     Instructs the browser to upgrade http:// sub-resources to https://.
 */
const ContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",   // Anti-clickjacking — stricter than X-Frame-Options
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

/**
 * Strict security headers applied to every response.
 * Order is irrelevant but kept logical for readability.
 */
const SECURITY_HEADERS = [
  // ── Anti-clickjacking ──────────────────────────────────────────────────
  // CSP frame-ancestors (above) is the modern standard; X-Frame-Options is
  // a legacy fallback for older browsers that don't understand CSP.
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },

  // ── MIME sniffing protection ───────────────────────────────────────────
  // Prevents browsers from interpreting files as a different MIME type,
  // blocking "MIME confusion" attacks (e.g. an uploaded image running as JS).
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },

  // ── Referrer policy ───────────────────────────────────────────────────
  // 'strict-origin-when-cross-origin':
  //   - Same-origin: full URL in Referer header (useful for analytics).
  //   - Cross-origin: only the origin (no path/query) — prevents leaking
  //     video URLs, user actions, or session tokens to third-party domains.
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },

  // ── HTTPS enforcement (HSTS) ──────────────────────────────────────────
  // Tells browsers to ONLY connect via HTTPS for the next 2 years.
  // includeSubDomains: applies to all subdomains.
  // preload: eligible for browser HSTS preload list submission.
  //
  // ⚠️  Warning: Only enable this on production. Local dev over HTTP will
  //     still work (HSTS is ignored on non-HTTPS connections), but if you
  //     accidentally serve the site over HTTPS with a bad cert, HSTS will
  //     lock users out. Remove `preload` if unsure about your cert setup.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },

  // ── Permissions policy ────────────────────────────────────────────────
  // Explicitly disable browser APIs this app does not use.
  // Prevents third-party scripts (if any slip through CSP) from
  // accessing sensitive device capabilities.
  {
    key: 'Permissions-Policy',
    value: [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'interest-cohort=()', // Opt out of FLoC tracking
    ].join(', '),
  },

  // ── DNS prefetch ──────────────────────────────────────────────────────
  // Allows browser to pre-resolve DNS for linked domains (performance).
  // Safe because DNS prefetch doesn't send cookies or auth headers.
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
];

// ─── Next.js Config ────────────────────────────────────────────────────────

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ── Security headers on all routes ──────────────────────────────────────
  async headers() {
    return [
      {
        // Apply to ALL routes: pages, API routes, static files.
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
    ];
  },

  // ── Image CDN allowlist ──────────────────────────────────────────────────
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ytimg.com' },
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: '**.cdninstagram.com' },
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: '**.tiktokcdn.com' },
      { protocol: 'https', hostname: 'p16-sign.tiktokcdn-us.com' },
      { protocol: 'https', hostname: 'p77-sign.tiktokcdn-us.com' },
      { protocol: 'https', hostname: 'p16-sign-va.tiktokcdn.com' },
    ],
  },

  // ── ESLint in build ──────────────────────────────────────────────────
  eslint: {
    ignoreDuringBuilds: true,
  },

  // ── External packages (server-side only) ────────────────────────────────
  // youtube-dl-exec uses Node.js native modules (child_process, fs).
  // Lazy-imported when DOWNLOADER_ENGINE=ytdlp; never imported on Vercel/Cobalt.
  experimental: {
    serverComponentsExternalPackages: ['youtube-dl-exec'],
  },
};

module.exports = nextConfig;
