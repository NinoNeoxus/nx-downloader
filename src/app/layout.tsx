import type { Metadata } from 'next';
import { Inter, Outfit } from 'next/font/google';
import { Toaster } from 'sonner';
import { SITE_CONFIG } from '@/lib/config';
import './globals.css';

// ─── Fonts ────────────────────────────────────────────────────────────────

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
});

// ─── SEO Metadata ─────────────────────────────────────────────────────────

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.url),
  title: `${SITE_CONFIG.name} — All-in-One Video & Audio Downloader`,
  description: SITE_CONFIG.description,
  keywords: [
    SITE_CONFIG.name,
    'video downloader',
    'youtube downloader',
    'tiktok downloader',
    'instagram downloader',
    'facebook video',
    'lossless audio',
    'fast muxing',
  ],
  authors: [{ name: 'NinoNeoxus', url: 'https://github.com/NinoNeoxus/nx-downloader' }],
  creator: 'NinoNeoxus',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: `${SITE_CONFIG.name} — Universal Media Downloader`,
    description: SITE_CONFIG.description,
    url: SITE_CONFIG.url,
    siteName: SITE_CONFIG.name,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_CONFIG.name} — Universal Media Downloader`,
    description: SITE_CONFIG.description,
  },
};

// ─── Layout ──────────────────────────────────────────────────────────────

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${outfit.variable}`}>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased selection:bg-cyan-500/30 selection:text-cyan-200">

        {/* ── Header: Brand Navigation ────────────────────────── */}
        <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 sm:px-8 py-3.5 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-xl">
          {/* Brand Logo & Name */}
          <a href="/" className="flex items-center gap-3 group">
            {/* Bespoke Geometric NX Monogram */}
            <div className="w-8 h-8 rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center shadow-inner group-hover:border-cyan-500/40 transition-colors">
              <svg viewBox="0 0 32 32" fill="none" className="w-5 h-5">
                <path
                  d="M7 24V8L17 24V8"
                  stroke="url(#nx-brand-grad)"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M25 8L16 24"
                  stroke="#38bdf8"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                />
                <path
                  d="M25 24L20 14.5"
                  stroke="#10b981"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="nx-brand-grad" x1="7" y1="8" x2="25" y2="24" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#38bdf8" />
                    <stop offset="1" stopColor="#10b981" />
                  </linearGradient>
                </defs>
              </svg>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="font-display font-bold text-base sm:text-lg text-white tracking-tight">
                {SITE_CONFIG.name}
              </span>
              <span className="hidden sm:inline-block text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                Core
              </span>
            </div>
          </a>

          {/* Right Nav & Status */}
          <div className="flex items-center gap-4 sm:gap-6">
            {/* System Status Indicator */}
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Operational</span>
            </div>

            {/* Navigation Links */}
            <nav className="flex items-center gap-4 text-xs font-medium text-zinc-400">
              <a href="/terms" className="hover:text-white transition-colors">
                Terms
              </a>
              <a href="/privacy" className="hover:text-white transition-colors">
                Privacy
              </a>
              <a
                href="https://github.com/NinoNeoxus/nx-downloader"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-block px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 hover:border-zinc-700 transition-all font-mono text-xs"
              >
                GitHub
              </a>
            </nav>
          </div>
        </header>

        {/* ── Page content ────────────────────────────────────────────── */}
        {children}

        {/* ── Sonner Toast ────────────────────────────────────────────── */}
        <Toaster
          theme="dark"
          position="bottom-right"
          richColors
          closeButton
          expand={false}
          toastOptions={{
            style: {
              background: 'rgba(24, 24, 27, 0.92)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(63, 63, 70, 0.7)',
              borderRadius: '12px',
              color: 'rgb(244, 244, 245)',
              fontFamily: 'var(--font-inter), system-ui, sans-serif',
              fontSize: '13.5px',
              boxShadow:
                '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)',
            },
            className: 'vidsnap-toast',
            duration: 5000,
          }}
        />
      </body>
    </html>
  );
}
