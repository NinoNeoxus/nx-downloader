import { NextRequest, NextResponse } from 'next/server';
import { getAdapter, getEngineType } from '@/lib/adapters';
import { AdapterError } from '@/lib/adapters/types';
import { EngineError } from '@/lib/engines/types';
import { ExtractResponse } from '@/types/media';

// ── Security: Rate limiting (Pillar 2) ──────────────────────────────────────
import { checkRateLimit, getClientIp, getClientCountry, buildRateLimitHeaders } from '@/lib/security/rate-limit';
import { checkIpAccess, recordIpActivity, isBotUserAgent } from '@/lib/security/abuse-protection';
import { logRequest } from '@/lib/security/telemetry';

// ── Security: URL validation + SSRF protection (Pillar 1) ───────────────────
import { UrlInputSchema, validateAndCleanUrl } from '@/lib/validation/url-schema';

// ─── Error Code → HTTP Status ──────────────────────────────────────────────

const STATUS_MAP: Record<string, number> = {
  PRIVATE_VIDEO: 403,
  NOT_FOUND: 404,
  GEO_BLOCKED: 451,
  AGE_RESTRICTED: 403,
  RATE_LIMITED: 429,
  EXTRACTION_FAILED: 500,
  UNSUPPORTED_FORMAT: 422,
  CONFIG_MISSING: 503,
};

// ─── POST /api/extract ─────────────────────────────────────────────────────
//
// Security chain (in order):
//   0. IP ban & Abuse check (fraud detection)
//   1. Rate limit  — reject if IP has exceeded limit
//   2. JSON parse  — reject malformed body
//   3. Zod schema  — reject structurally invalid payload (length, type)
//   4. SSRF guard  — reject private IPs, non-allowlisted domains
//   5. URL clean   — strip tracking params before engine call
//   6. Adapter     — extract metadata via yt-dlp or Cobalt
//   7. Telemetry   — log request, status, duration, platform

export async function POST(req: NextRequest): Promise<NextResponse<ExtractResponse>> {
  const startTime = Date.now();
  const clientIp = getClientIp(req);
  const country = getClientCountry(req);
  const userAgent = req.headers.get('user-agent') || '';

  // ── 0. Anti-Abuse & Ban Check ─────────────────────────────────────────────
  const accessCheck = checkIpAccess(clientIp, userAgent);
  if (!accessCheck.allowed) {
    logRequest({
      ip: clientIp,
      country,
      endpoint: '/api/extract',
      statusCode: 403,
      durationMs: Date.now() - startTime,
      bytesTransferred: 0,
      userAgent,
      isBot: isBotUserAgent(userAgent),
    });
    return NextResponse.json(
      { success: false, error: accessCheck.reason || 'Akses ditolak.', code: (accessCheck.code as any) || 'FORBIDDEN' },
      { status: 403 }
    );
  }

  // ── 1. Rate limiting ──────────────────────────────────────────────────────
  const rateLimit = checkRateLimit(clientIp);
  const rateLimitHeaders = buildRateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    recordIpActivity(clientIp, { isError: true, userAgent });
    logRequest({
      ip: clientIp,
      country,
      endpoint: '/api/extract',
      statusCode: 429,
      durationMs: Date.now() - startTime,
      bytesTransferred: 0,
      userAgent,
      isBot: isBotUserAgent(userAgent),
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Rate limit exceeded. Please wait a moment before trying again.',
        code: 'RATE_LIMITED',
      },
      {
        status: 429,
        headers: rateLimitHeaders,
      },
    );
  }

  // ── 2. Parse request body ─────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Request body must be valid JSON.', code: 'INVALID_JSON' },
      { status: 400, headers: rateLimitHeaders },
    );
  }

  // ── 3. Zod structural validation (shape + length) ─────────────────────────
  const parsed = UrlInputSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors[0]?.message ?? 'Invalid request payload.';
    return NextResponse.json(
      { success: false, error: message, code: 'VALIDATION_ERROR' },
      { status: 400, headers: rateLimitHeaders },
    );
  }

  const { url: rawUrl } = parsed.data;

  // ── 4 & 5. SSRF check + domain allowlist + tracking-param strip ───────────
  const validation = validateAndCleanUrl(rawUrl);
  if (!validation.success) {
    // Map validation error codes to appropriate HTTP statuses
    const httpStatus = validation.code === 'SSRF_BLOCKED' ? 403 : 422;
    return NextResponse.json(
      { success: false, error: validation.error, code: validation.code },
      { status: httpStatus, headers: rateLimitHeaders },
    );
  }

  const { cleanedUrl, platform } = validation;

  // ── 6. Get adapter (engine selection: DOWNLOADER_ENGINE env var) ──────────
  let adapter;
  try {
    adapter = await getAdapter(platform);
  } catch (err: unknown) {
    if (err instanceof EngineError) {
      console.error('[/api/extract] Engine config error:', err.message);
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: 503, headers: rateLimitHeaders },
      );
    }
    throw err;
  }

  // ── 7. Extract metadata (passes CLEANED URL — tracking params stripped) ───
  try {
    const metadata = await adapter.extract(cleanedUrl);
    recordIpActivity(clientIp, { userAgent });
    logRequest({
      ip: clientIp,
      country,
      endpoint: '/api/extract',
      platform,
      targetUrl: cleanedUrl,
      title: metadata.title,
      statusCode: 200,
      durationMs: Date.now() - startTime,
      bytesTransferred: 0,
      userAgent,
      isBot: isBotUserAgent(userAgent),
    });

    return NextResponse.json(
      { success: true, data: metadata },
      { status: 200, headers: rateLimitHeaders },
    );
  } catch (err: unknown) {
    console.error('[/api/extract] RAW ERROR:', err);
    recordIpActivity(clientIp, { isError: true, userAgent });

    let status = 500;
    let code: string = 'INTERNAL_ERROR';
    let errorMessage = 'An unexpected error occurred. Please try again.';

    if (err instanceof AdapterError) {
      status = STATUS_MAP[err.code] ?? 500;
      code = err.code;
      errorMessage = err.message;
    } else if (err instanceof EngineError) {
      status = STATUS_MAP[err.code] ?? 500;
      code = err.code;
      errorMessage = err.message;
    }

    logRequest({
      ip: clientIp,
      country,
      endpoint: '/api/extract',
      platform,
      targetUrl: cleanedUrl,
      statusCode: status,
      durationMs: Date.now() - startTime,
      bytesTransferred: 0,
      userAgent,
      isBot: isBotUserAgent(userAgent),
    });

    return NextResponse.json(
      { success: false, error: errorMessage, code: code as any },
      { status, headers: rateLimitHeaders },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed.' }, { status: 405 });
}
