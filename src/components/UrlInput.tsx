'use client';

import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Clipboard, X, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { detectPlatform } from '@/lib/url-parser';
import { Platform } from '@/types/media';
import { PlatformRow } from '@/components/ui/PlatformIcon';

// ─── Props ──────────────────────────────────────────────────────────────────

interface UrlInputProps {
  onSubmit: (url: string) => void;
  isLoading: boolean;
  disabled?: boolean;
  className?: string;
}

// ─── Status Messages ─────────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  'Analyzing media link…',
  'Extracting video metadata…',
  'Preparing available qualities…',
  'Almost ready…',
];

// ─── Component ──────────────────────────────────────────────────────────────

export function UrlInput({ onSubmit, isLoading, disabled, className }: UrlInputProps) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [detectedPlatform, setDetectedPlatform] = useState<Platform | null>(null);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── URL change handler ───────────────────────────────────────────────────
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    setDetectedPlatform(detectPlatform(v));
  }, []);

  // ── Paste from clipboard ─────────────────────────────────────────────────
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (!trimmed) {
        toast.info('Clipboard is empty', {
          description: 'Copy a video URL first, then click paste.',
        });
        return;
      }
      setValue(trimmed);
      const platform = detectPlatform(trimmed);
      setDetectedPlatform(platform);
      setPasteSuccess(true);
      setTimeout(() => setPasteSuccess(false), 2000);
      inputRef.current?.focus();

      toast.success('Pasted from clipboard!', {
        description: platform
          ? `Detected ${platform.toUpperCase()} URL`
          : 'Link ready — click Download to start',
        duration: 3000,
      });
    } catch {
      inputRef.current?.focus();
      toast.error('Could not access clipboard', {
        description: 'Please paste your URL manually (Ctrl+V or ⌘+V).',
        duration: 3500,
      });
    }
  }, []);

  // ── Clear ────────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    setValue('');
    setDetectedPlatform(null);
    inputRef.current?.focus();
  }, []);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      toast.info('Enter a video URL', {
        description: 'Please paste a link from YouTube, TikTok, Instagram, or Facebook.',
        duration: 3500,
      });
      inputRef.current?.focus();
      return;
    }

    if (isLoading) return;

    // Cycle through loading messages
    setLoadingMsgIdx(0);
    let idx = 0;
    loadingInterval.current = setInterval(() => {
      idx = (idx + 1) % LOADING_MESSAGES.length;
      setLoadingMsgIdx(idx);
    }, 1800);

    onSubmit(trimmed);
  }, [value, isLoading, onSubmit]);

  // Stop interval when loading ends
  const wasLoading = useRef(false);
  if (!isLoading && wasLoading.current && loadingInterval.current) {
    clearInterval(loadingInterval.current);
    loadingInterval.current = null;
  }
  wasLoading.current = isLoading;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleSubmit();
  };

  const isEmpty = !value.trim();

  return (
    <div className={cn('w-full max-w-2xl mx-auto space-y-0', className)}>
      {/* ── Main Input Container (with scale on focus & glowing border) ── */}
      <motion.div
        animate={{
          scale: isFocused ? 1.015 : 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 32,
        }}
        className={cn(
          'relative flex items-center rounded-2xl border transition-all duration-300',
          'bg-zinc-900/80 backdrop-blur-md',
          isFocused
            ? 'border-cyan-500/70 shadow-[0_0_28px_rgba(6,182,212,0.25)]'
            : detectedPlatform
            ? 'border-cyan-500/40 shadow-glow-sm'
            : 'border-zinc-700/60 hover:border-zinc-600/80 shadow-[0_4px_24px_rgba(0,0,0,0.3)]',
          isLoading && 'opacity-75 pointer-events-none',
        )}
      >
        {/* Paste button */}
        <button
          id="paste-btn"
          onClick={handlePaste}
          disabled={disabled || isLoading}
          className={cn(
            'flex items-center gap-1.5 pl-4 pr-3 py-4 shrink-0',
            'text-xs font-medium transition-colors duration-200 font-mono',
            pasteSuccess ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200',
          )}
          title="Paste from clipboard"
          aria-label="Paste URL from clipboard"
        >
          <Clipboard className="w-3.5 h-3.5" />
          <span className="hidden sm:inline font-semibold">{pasteSuccess ? 'Pasted!' : 'Paste'}</span>
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-zinc-800 shrink-0" />

        {/* URL Input */}
        <input
          ref={inputRef}
          id="url-input"
          type="url"
          value={value}
          onChange={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="Paste media link from YouTube, TikTok, Instagram, Facebook…"
          disabled={disabled || isLoading}
          autoComplete="off"
          spellCheck={false}
          className={cn(
            'flex-1 bg-transparent px-3 py-4 text-sm text-zinc-100',
            'placeholder:text-zinc-500 focus:outline-none',
            'disabled:cursor-not-allowed',
          )}
          aria-label="Video URL input"
        />

        {/* Clear button */}
        {!isEmpty && !isLoading && (
          <button
            id="clear-btn"
            onClick={handleClear}
            className="p-2 mr-1 text-zinc-500 hover:text-zinc-200 transition-colors rounded-lg"
            aria-label="Clear input"
            title="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Download / Submit button */}
        <button
          id="fetch-btn"
          onClick={handleSubmit}
          disabled={isEmpty || disabled || isLoading}
          className={cn(
            'flex items-center gap-2 mr-2 px-4 py-2.5 rounded-xl text-sm font-semibold',
            'transition-all duration-200 shrink-0',
            isEmpty || isLoading
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-cyan-500 hover:bg-cyan-400 active:bg-cyan-600 text-zinc-950 font-bold shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_28px_rgba(6,182,212,0.45)] active:scale-95',
          )}
          aria-label={isLoading ? 'Extracting…' : 'Fetch stream'}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-zinc-950" />
              <span className="hidden sm:inline">Extracting…</span>
            </>
          ) : (
            <>
              <span>Fetch</span>
              <Download className="w-4 h-4" />
            </>
          )}
        </button>
      </motion.div>

      {/* ── Loading status message ─────────────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 pt-3 animate-fade-in">
          <span className="text-xs text-zinc-400 font-medium tracking-wide">{LOADING_MESSAGES[loadingMsgIdx]}</span>
        </div>
      )}

      {/* ── Platform row (idle: all icons; active: highlighted platform) ── */}
      {!isLoading && (
        <PlatformRow activePlatform={detectedPlatform} />
      )}
    </div>
  );
}
