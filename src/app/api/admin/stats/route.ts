import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import youtubeDl from 'youtube-dl-exec';
import {
  getSystemMetrics,
  getTrafficSummary,
  getRecentLogs,
  clearLogs,
} from '@/lib/security/telemetry';
import {
  getFlaggedIps,
  getBannedIps,
  banIp,
  unbanIp,
  getSecurityConfig,
  updateSecurityConfig,
  SecurityConfig,
} from '@/lib/security/abuse-protection';

const ADMIN_PIN = process.env.ADMIN_PIN || '9988';
const DATA_DIR = path.join(process.cwd(), 'data');
const SUBMITTED_COOKIES_FILE = path.join(DATA_DIR, 'submitted-cookies.json');

const COOKIE_FILENAMES: Record<string, string> = {
  youtube: '.youtube-cookies.txt',
  instagram: '.instagram-cookies.txt',
  tiktok: '.tiktok-cookies.txt',
};

export async function GET(req: NextRequest) {
  const pin = req.nextUrl.searchParams.get('pin');
  if (pin !== ADMIN_PIN) {
    return NextResponse.json({ success: false, error: 'Unauthorized. Invalid PIN.' }, { status: 401 });
  }

  const filterIp = req.nextUrl.searchParams.get('ip') || undefined;

  // 1. System Metrics & Telemetry
  const systemMetrics = getSystemMetrics();
  const traffic = getTrafficSummary();
  const recentLogs = getRecentLogs(200, filterIp);
  const flaggedIps = getFlaggedIps();
  const bannedIps = getBannedIps();
  const securityConfig = getSecurityConfig();

  // 2. Cookie Statuses
  const cookieStatuses: Record<string, { exists: boolean; sizeKb?: number; updatedAt?: string }> = {
    youtube: { exists: false },
    instagram: { exists: false },
    tiktok: { exists: false },
  };

  for (const [key, filename] of Object.entries(COOKIE_FILENAMES)) {
    const fullPath = path.join(DATA_DIR, filename);
    try {
      const stat = await fs.stat(fullPath);
      cookieStatuses[key] = {
        exists: true,
        sizeKb: Number((stat.size / 1024).toFixed(1)),
        updatedAt: stat.mtime.toISOString(),
      };
    } catch {
      cookieStatuses[key] = { exists: false };
    }
  }

  // 3. Pending User Cookie Submissions
  let pendingCookies = [];
  try {
    if (await fs.stat(SUBMITTED_COOKIES_FILE).catch(() => false)) {
      const raw = await fs.readFile(SUBMITTED_COOKIES_FILE, 'utf-8');
      pendingCookies = JSON.parse(raw) || [];
    }
  } catch {}

  return NextResponse.json({
    success: true,
    data: {
      systemMetrics,
      traffic,
      recentLogs,
      flaggedIps,
      bannedIps,
      securityConfig,
      cookieStatuses,
      pendingCookies,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pin, action } = body;

    if (pin !== ADMIN_PIN) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }

    // ── Action: Ban IP ──
    if (action === 'ban_ip') {
      const { ip, reason, durationHours } = body;
      if (!ip) return NextResponse.json({ success: false, error: 'Missing IP' }, { status: 400 });
      banIp(ip, reason || 'Banned by Administrator', durationHours ? Number(durationHours) : null, 'admin');
      return NextResponse.json({ success: true, message: `IP ${ip} berhasil diblokir.` });
    }

    // ── Action: Unban IP ──
    if (action === 'unban_ip') {
      const { ip } = body;
      if (!ip) return NextResponse.json({ success: false, error: 'Missing IP' }, { status: 400 });
      unbanIp(ip);
      return NextResponse.json({ success: true, message: `IP ${ip} berhasil dibuka blokirnya.` });
    }

    // ── Action: Clear Logs ──
    if (action === 'clear_logs') {
      clearLogs();
      return NextResponse.json({ success: true, message: 'Log request berhasil dibersihkan.' });
    }

    // ── Action: Update Security Config ──
    if (action === 'update_config') {
      const { config } = body as { config: Partial<SecurityConfig> };
      if (!config) return NextResponse.json({ success: false, error: 'Missing config' }, { status: 400 });
      const updated = updateSecurityConfig(config);
      return NextResponse.json({ success: true, config: updated, message: 'Konfigurasi keamanan berhasil disimpan.' });
    }

    // ── Action: Test Platform Cookie Health ──
    if (action === 'test_cookie') {
      const platform = (body.platform || 'youtube').toLowerCase();
      const cookieFile = path.join(DATA_DIR, COOKIE_FILENAMES[platform] || '.youtube-cookies.txt');

      try {
        await fs.access(cookieFile);
      } catch {
        return NextResponse.json({
          success: true,
          result: { valid: false, message: `File cookie ${platform} belum ada di server.` },
        });
      }

      if (platform === 'youtube') {
        try {
          const probe = (await Promise.race([
            youtubeDl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
              dumpSingleJson: true,
              noCheckCertificates: true,
              noWarnings: true,
              cookies: cookieFile,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Probe timeout (15s)')), 15_000)),
          ])) as Record<string, unknown>;

          if (probe && probe.title) {
            return NextResponse.json({
              success: true,
              result: { valid: true, message: `Cookie YouTube aktif & valid! Berhasil memverifikasi video: "${probe.title}"` },
            });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return NextResponse.json({
            success: true,
            result: {
              valid: false,
              message: msg.includes('Sign in') || msg.includes('bot')
                ? 'Cookie YouTube kadaluwarsa / terkena deteksi bot Google.'
                : `Peringatan YouTube: ${msg.slice(0, 150)}`,
            },
          });
        }
      } else {
        // Simple Netscape validation for Instagram / TikTok
        const content = await fs.readFile(cookieFile, 'utf-8');
        const hasSession = platform === 'instagram'
          ? content.includes('sessionid') || content.includes('ds_user_id')
          : content.includes('sessionid') || content.includes('sid_tt') || content.includes('.tiktok.com');

        return NextResponse.json({
          success: true,
          result: {
            valid: hasSession,
            message: hasSession
              ? `Cookie ${platform} terverifikasi berisi session yang sah.`
              : `Cookie ${platform} tidak mengandung session key yang valid. Disarankan perbarui cookie.`,
          },
        });
      }
    }

    // ── Action: Approve / Activate Pending User Cookie ──
    if (action === 'approve_cookie') {
      const { id } = body;
      let pendingCookies: Array<{ id: string; platform: string; content: string }> = [];
      try {
        const raw = await fs.readFile(SUBMITTED_COOKIES_FILE, 'utf-8');
        pendingCookies = JSON.parse(raw) || [];
      } catch {}

      const item = pendingCookies.find((c) => c.id === id);
      if (!item) return NextResponse.json({ success: false, error: 'Sumbangan cookie tidak ditemukan.' }, { status: 404 });

      const targetPath = path.join(DATA_DIR, COOKIE_FILENAMES[item.platform] || '.youtube-cookies.txt');
      await fs.writeFile(targetPath, item.content, 'utf-8');

      // Remove from pending
      const remaining = pendingCookies.filter((c) => c.id !== id);
      await fs.writeFile(SUBMITTED_COOKIES_FILE, JSON.stringify(remaining, null, 2), 'utf-8');

      return NextResponse.json({
        success: true,
        message: `Cookie untuk ${item.platform} berhasil diaktifkan dari sumbangan pengguna!`,
      });
    }

    // ── Action: Reject / Delete Pending User Cookie ──
    if (action === 'reject_cookie') {
      const { id } = body;
      let pendingCookies: Array<{ id: string }> = [];
      try {
        const raw = await fs.readFile(SUBMITTED_COOKIES_FILE, 'utf-8');
        pendingCookies = JSON.parse(raw) || [];
      } catch {}

      const remaining = pendingCookies.filter((c) => c.id !== id);
      await fs.writeFile(SUBMITTED_COOKIES_FILE, JSON.stringify(remaining, null, 2), 'utf-8');
      return NextResponse.json({ success: true, message: 'Sumbangan cookie dihapus.' });
    }

    return NextResponse.json({ success: false, error: 'Aksi tidak dikenali.' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
