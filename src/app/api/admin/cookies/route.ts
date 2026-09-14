import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const ADMIN_PIN = process.env.ADMIN_PIN || '9988';

export type PlatformCookieKey = 'youtube' | 'instagram' | 'tiktok';

const COOKIE_FILENAMES: Record<PlatformCookieKey, string> = {
  youtube: '.youtube-cookies.txt',
  instagram: '.instagram-cookies.txt',
  tiktok: '.tiktok-cookies.txt',
};

const VALIDATION_DOMAINS: Record<PlatformCookieKey, string[]> = {
  youtube: ['.youtube.com', 'youtube.com'],
  instagram: ['.instagram.com', 'instagram.com'],
  tiktok: ['.tiktok.com', 'tiktok.com'],
};

export async function GET(req: NextRequest) {
  const pin = req.nextUrl.searchParams.get('pin');
  if (pin !== ADMIN_PIN) {
    return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const dataDir = path.join(process.cwd(), 'data');
  const statuses: Record<
    PlatformCookieKey,
    { exists: boolean; sizeKb?: number; updatedAt?: string }
  > = {
    youtube: { exists: false },
    instagram: { exists: false },
    tiktok: { exists: false },
  };

  for (const [key, filename] of Object.entries(COOKIE_FILENAMES) as [PlatformCookieKey, string][]) {
    const fullPath = path.join(dataDir, filename);
    try {
      const stat = await fs.stat(fullPath);
      statuses[key] = {
        exists: true,
        sizeKb: Number((stat.size / 1024).toFixed(1)),
        updatedAt: stat.mtime.toISOString(),
      };
    } catch {
      statuses[key] = { exists: false };
    }
  }

  return NextResponse.json({ success: true, statuses });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const pin = formData.get('pin');
    const platform = ((formData.get('platform') as string) || 'youtube').toLowerCase() as PlatformCookieKey;
    const file = formData.get('file') as File | null;

    if (pin !== ADMIN_PIN) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Invalid PIN.' },
        { status: 401 }
      );
    }

    if (!['youtube', 'instagram', 'tiktok'].includes(platform)) {
      return NextResponse.json(
        { success: false, error: 'Platform tidak valid. Pilihan: youtube, instagram, tiktok.' },
        { status: 400 }
      );
    }

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'No file uploaded.' },
        { status: 400 }
      );
    }

    // Convert the File (Web API) to a Node.js Buffer — preserves all bytes
    // including literal Tab characters required by the Netscape cookie format.
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const content = buffer.toString('utf-8');

    // Validation: Ensure the cookie file actually contains session cookies for the chosen platform
    const validDomains = VALIDATION_DOMAINS[platform] || [];
    const isValid = validDomains.some((d) => content.includes(d));

    if (!isValid) {
      const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
      return NextResponse.json(
        {
          success: false,
          error: `File cookies tidak valid! Tidak ditemukan cookie ${platformName} (${validDomains[0]}). Pastikan kamu buka tab ${platformName} yang sudah login sebelum mengekspor cookies.`,
        },
        { status: 400 }
      );
    }

    const dataDir = path.join(process.cwd(), 'data');
    const targetFilename = COOKIE_FILENAMES[platform];
    const cookieFile = path.join(dataDir, targetFilename);

    // Ensure data directory exists
    await fs.mkdir(dataDir, { recursive: true });

    // Write the raw buffer — no encoding conversion, no corruption
    await fs.writeFile(cookieFile, buffer);

    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
    return NextResponse.json({
      success: true,
      message: `Cookies ${platformName} berhasil disimpan dan diaktifkan. (${(buffer.byteLength / 1024).toFixed(1)} KB)`,
    });
  } catch (error) {
    console.error('[/api/admin/cookies] Error saving cookies:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error while saving cookies.' },
      { status: 500 }
    );
  }
}
