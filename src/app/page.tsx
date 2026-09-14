'use client';

import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { UrlInput } from '@/components/UrlInput';
import { ResultCard } from '@/components/ResultCard';
import { LoadingSkeleton } from '@/components/LoadingSkeleton';
import { AppState, MediaMetadata, ExtractResponse } from '@/types/media';
import { SITE_CONFIG } from '@/lib/config';

// ─── Motion Variants ────────────────────────────────────────────────────────
//
// These variants are the "language" of the UI's motion design.
// Each variant name maps to a semantic state in our AppState machine.
//
// Design principles:
//   - Enter animations always move content INTO its resting position (up/fade)
//   - Exit animations are faster and simpler (just fade) — the user's goal
//     is to see the new state, not to watch the old one leave
//   - Spring physics for enter (feels alive), ease-out for exit (clean)

const cardVariants = {
  hidden: {
    opacity: 0,
    y: 24,
    scale: 0.98,
    filter: 'blur(4px)',
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 28,
      mass: 0.8,
    },
  },
  exit: {
    opacity: 0,
    y: -10,
    scale: 0.98,
    filter: 'blur(2px)',
    transition: {
      duration: 0.18,
      ease: 'easeIn',
    },
  },
};

const skeletonVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: 'easeOut' },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15, ease: 'easeIn' },
  },
};

// ─── Page ──────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [state, setState] = useState<AppState>('idle');
  const [metadata, setMetadata] = useState<MediaMetadata | null>(null);

  // ── Handle URL submission ──────────────────────────────────────────────
  const handleFetch = useCallback(async (url: string) => {
    setState('loading');
    setMetadata(null);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const json: ExtractResponse = await res.json();

      if (json.success) {
        setMetadata(json.data);
        setState('success');
        // Success toast — reassures user the fetch worked
        toast.success('Video info fetched!', {
          description: json.data.title.slice(0, 60) + (json.data.title.length > 60 ? '…' : ''),
          duration: 3500,
        });
      } else {
        setState('error');

        // Map specific error codes to rich toast variants
        const isRateLimit = json.code === 'RATE_LIMITED';
        const isPrivate = json.code === 'PRIVATE_VIDEO';

        if (isRateLimit) {
          toast.warning('Slow down!', {
            description: json.error,
            duration: 6000,
          });
        } else if (isPrivate) {
          toast.error('Private content', {
            description: json.error,
            duration: 6000,
          });
        } else {
          toast.error('Could not fetch video', {
            description: json.error ?? 'Something went wrong. Please try again.',
            duration: 5000,
          });
        }
      }
    } catch (err: unknown) {
      setState('error');
      const msg =
        err instanceof Error && err.message.includes('fetch')
          ? 'Network error — please check your connection.'
          : 'An unexpected error occurred. Please try again.';
      toast.error('Request failed', { description: msg, duration: 5000 });
    }
  }, []);

  // ── Retry: return to idle ──────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setState('idle');
    setMetadata(null);
  }, []);

  const isLoading = state === 'loading';

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-start px-4 pt-24 pb-16 overflow-hidden">

      {/* ── Background: layered depth ──────────────────────────────────── */}
      {/* Layer 1: subtle grid */}
      <div
        className="pointer-events-none absolute inset-0 bg-grid-pattern opacity-[0.18]"
        style={{
          maskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 70% at 50% 0%, black 30%, transparent 100%)',
        }}
      />
      {/* Layer 2: brand glow at top */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 40% at 50% -5%, rgba(14,165,233,0.10) 0%, transparent 70%)',
        }}
      />
      {/* Layer 3: secondary accent glow (subtle purple tint, bottom) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 30% at 80% 100%, rgba(99,102,241,0.05) 0%, transparent 60%)',
        }}
      />

      {/* ── Hero Section ──────────────────────────────────────────────── */}
      <motion.section
        className="relative z-10 text-center max-w-2xl w-full mb-10"
        initial={false}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Eyebrow */}
        <div className="flex justify-center mb-5">
          <span className="inline-flex items-center gap-2 text-[11px] text-zinc-400 font-mono tracking-wider uppercase px-3.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-800/90 shadow-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            {SITE_CONFIG.name} · UNIVERSAL EXTRACTOR
          </span>
        </div>

        {/* Headline */}
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.08] mb-4">
          All-in-One{' '}
          <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">
            Video &amp; Audio Downloader
          </span>
        </h1>

        {/* Subtitle */}
        <p className="text-zinc-400 text-sm sm:text-base leading-relaxed max-w-xl mx-auto">
          Download high-resolution video and studio-quality audio from YouTube, TikTok, Instagram, and Facebook in seconds.
        </p>
      </motion.section>

      {/* ── Input Area ─────────────────────────────────────────────────── */}
      <motion.section
        className="relative z-10 w-full max-w-2xl mb-6"
        initial={false}
        animate={{ opacity: 1, y: 0 }}
      >
        <UrlInput
          onSubmit={handleFetch}
          isLoading={isLoading}
          disabled={isLoading}
        />
      </motion.section>

      {/* ── State-driven content (animated) ───────────────────────────── */}
      <section className="relative z-10 w-full max-w-2xl">
        <AnimatePresence mode="wait">

          {/* Loading skeleton */}
          {state === 'loading' && (
            <motion.div
              key="skeleton"
              variants={skeletonVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <LoadingSkeleton />
            </motion.div>
          )}

          {/* Success: ResultCard slides up with spring */}
          {state === 'success' && metadata && (
            <motion.div
              key={`result-${metadata.id}`}
              variants={cardVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <ResultCard metadata={metadata} />
            </motion.div>
          )}

          {/* Error state: replaced by sonner toast — show inline retry hint */}
          {state === 'error' && (
            <motion.div
              key="error-hint"
              variants={skeletonVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="flex flex-col items-center gap-3 py-6 text-center"
            >
              <p className="text-sm text-zinc-500">
                Check the toast notification for details.
              </p>
              <button
                onClick={handleRetry}
                className="text-xs text-brand-400 hover:text-brand-300 underline underline-offset-4 transition-colors font-mono"
              >
                Try another URL
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="relative z-10 w-full max-w-4xl mx-auto mt-auto pt-20 pb-8 text-xs text-zinc-500 space-y-6">
        <div className="border-t border-zinc-800/80 pt-8 grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
          {/* Col 1: Brand & Creator */}
          <div className="space-y-2">
            <div className="text-zinc-200 font-bold font-display text-sm tracking-tight">
              NX Downloader
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Powered by NEOXUS Core Engine. Designed for creator workflows, offline archival, and personal fair-use study.
            </p>
            <div className="font-mono text-[11px] text-zinc-400">
              Creator: <span className="text-zinc-200">neoxus</span>
            </div>
          </div>

          {/* Col 2: Legal Compliance */}
          <div className="space-y-2">
            <div className="text-zinc-300 font-semibold font-mono text-[11px] uppercase tracking-wider">
              Legal &amp; Policy
            </div>
            <ul className="space-y-1.5 text-[11px]">
              <li>
                <a href="/terms" className="hover:text-cyan-400 transition-colors">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="/privacy" className="hover:text-cyan-400 transition-colors">
                  Privacy Policy &amp; Zero Retention
                </a>
              </li>
              <li>
                <a href="/terms#dmca" className="hover:text-cyan-400 transition-colors">
                  DMCA / Copyright Compliance
                </a>
              </li>
            </ul>
          </div>

          {/* Col 3: Source & Repository */}
          <div className="space-y-2">
            <div className="text-zinc-300 font-semibold font-mono text-[11px] uppercase tracking-wider">
              Source &amp; Repository
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              Official releases and community repository:
            </p>
            <a
              href="https://github.com/NinoNeoxus/nx-downloader"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-mono text-[11px] text-cyan-400 hover:underline"
            >
              github.com/NinoNeoxus/nx-downloader
            </a>
            <div className="pt-1">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-zinc-400 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                Core Engine: Operational
              </span>
            </div>
          </div>
        </div>

        {/* Legal Disclaimer Shield */}
        <div className="p-3.5 rounded-xl bg-zinc-950/90 border border-zinc-800/80 text-[10px] text-zinc-500 leading-relaxed text-center sm:text-left">
          <strong>Disclaimer:</strong> {SITE_CONFIG.name} is a high-performance stream transmission and muxing utility.
          We do not host, index, or distribute copyrighted media files.
          Users are responsible for ensuring their usage complies with relevant copyright laws and platform terms.
          YouTube, TikTok, Instagram, and Facebook are trademarks of their respective owners.
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] text-zinc-600 font-mono">
          <div>© {new Date().getFullYear()} {SITE_CONFIG.name}. All rights reserved.</div>
          <div>Distributed via NinoNeoxus / nx-downloader</div>
        </div>
      </footer>
    </main>
  );
}
