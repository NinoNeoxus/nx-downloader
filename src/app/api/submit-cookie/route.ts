import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getClientIp } from '@/lib/security/rate-limit';

const DATA_DIR = path.join(process.cwd(), 'data');
const SUBMITTED_COOKIES_FILE = path.join(DATA_DIR, 'submitted-cookies.json');

const VALIDATION_DOMAINS: Record<string, string[]> = {
  youtube: ['.youtube.com', 'youtube.com'],
  instagram: ['.instagram.com', 'instagram.com'],
  tiktok: ['.tiktok.com', 'tiktok.com'],
};

// Rate limiter: max 5 cookie uploads per IP per hour
const submissionMap = new Map<string, { count: number; windowStart: number }>();

export async function POST(req: NextRequest) {
  try {
    const clientIp = getClientIp(req);
    const now = Date.now();

    // Rate limit check
    const record = submissionMap.get(clientIp);
    if (record) {
      if (now - record.windowStart < 3600_000) {
        if (record.count >= 5) {
          return NextResponse.json(
            { success: false, error: 'Terlalu banyak permintaan upload. Harap tunggu beberapa saat.' },
            { status: 429 }
          );
        }
        record.count += 1;
      } else {
        submissionMap.set(clientIp, { count: 1, windowStart: now });
      }
    } else {
      submissionMap.set(clientIp, { count: 1, windowStart: now });
    }

    const formData = await req.formData();
    const platform = ((formData.get('platform') as string) || 'youtube').toLowerCase();
    const note = (formData.get('note') as string) || '';
    const file = formData.get('file') as File | null;

    if (!['youtube', 'instagram', 'tiktok'].includes(platform)) {
      return NextResponse.json({ success: false, error: 'Platform tidak valid.' }, { status: 400 });
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'File tidak ditemukan.' }, { status: 400 });
    }

    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'Ukuran file terlalu besar (maksimal 2MB).' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const content = buffer.toString('utf-8');

    // Validation
    const validDomains = VALIDATION_DOMAINS[platform] || [];
    const isValid = validDomains.some((d) => content.includes(d));

    if (!isValid) {
      return NextResponse.json(
        {
          success: false,
          error: `File tidak valid! Tidak ditemukan cookie ${platform}. Pastikan Anda login dan mengekspor dari tab ${platform}.com.`,
        },
        { status: 400 }
      );
    }

    // Read existing pending cookies
    let pendingCookies: Array<{
      id: string;
      platform: string;
      submittedAt: string;
      ip: string;
      sizeKb: number;
      note: string;
      content: string;
    }> = [];

    try {
      if (!fs.stat(DATA_DIR).catch(() => false)) {
        await fs.mkdir(DATA_DIR, { recursive: true });
      }
      const raw = await fs.readFile(SUBMITTED_COOKIES_FILE, 'utf-8');
      pendingCookies = JSON.parse(raw) || [];
    } catch {}

    const newEntry = {
      id: `cookie_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      platform,
      submittedAt: new Date().toISOString(),
      ip: clientIp,
      sizeKb: Number((buffer.length / 1024).toFixed(1)),
      note: note.slice(0, 200),
      content,
    };

    // Keep last 20 submissions
    pendingCookies.unshift(newEntry);
    if (pendingCookies.length > 20) {
      pendingCookies.pop();
    }

    await fs.writeFile(SUBMITTED_COOKIES_FILE, JSON.stringify(pendingCookies, null, 2), 'utf-8');

    return NextResponse.json({
      success: true,
      message: `Terima kasih! Cookie ${platform} berhasil dikirim dan akan diverifikasi oleh server.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
