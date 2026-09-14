'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Loader2,
  X,
  Film,
  ExternalLink,
} from 'lucide-react';
import { AvailableFormat } from '@/types/media';
import { SITE_CONFIG } from '@/lib/config';

interface AdGateModalProps {
  isOpen: boolean;
  format: AvailableFormat | null;
  videoTitle: string;
  onVerified: () => void;
  onCancel: () => void;
}

export function AdGateModal({
  isOpen,
  format,
  videoTitle,
  onVerified,
  onCancel,
}: AdGateModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(5);
  const [isDone, setIsDone] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const adLink = SITE_CONFIG.adGate.directUrl || '#';

  useEffect(() => {
    if (isOpen && format) {
      setSecondsLeft(5);
      setIsDone(false);

      let count = 5;
      if (timerRef.current) clearInterval(timerRef.current);

      timerRef.current = setInterval(() => {
        count -= 1;
        setSecondsLeft(count);
        if (count <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          setIsDone(true);
          setTimeout(() => {
            onVerified();
          }, 600);
        }
      }, 1000);
    } else {
      setSecondsLeft(5);
      setIsDone(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isOpen, format, onVerified]);

  if (!isOpen || !format) return null;

  const handleClose = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    onCancel();
  };

  const handleManualOpenAd = () => {
    if (typeof window !== 'undefined' && SITE_CONFIG.adGate.directUrl) {
      window.open(SITE_CONFIG.adGate.directUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const pct = Math.max(0, Math.min(100, ((5 - secondsLeft) / 5) * 100));

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="relative w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden p-5 text-zinc-100"
        >
          {/* Top Bar: Minimal AD Badge & Close Button */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold font-mono bg-zinc-800 text-amber-400 border border-amber-500/30">
                AD
              </span>
              <span className="text-xs font-semibold text-zinc-300">
                Sponsor Verification
              </span>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="w-7 h-7 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Media Info Pill */}
          <div className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80 mb-3 flex items-center justify-between text-xs">
            <div className="truncate pr-2">
              <div className="font-medium text-zinc-200 truncate flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                <span className="truncate">{videoTitle}</span>
              </div>
              <div className="text-zinc-500 text-[11px] mt-0.5 font-mono">
                {format.quality} • {format.ext.toUpperCase()}
              </div>
            </div>
            <span className="text-zinc-400 font-mono text-[11px] shrink-0 font-medium">
              {format.size}
            </span>
          </div>

          {/* External Sponsor Button */}
          {SITE_CONFIG.adGate.directUrl && (
            <div className="mb-3">
              <a
                href={adLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleManualOpenAd}
                className="w-full py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white border border-zinc-700/80 font-medium text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.99] text-center no-underline"
              >
                <span>Continue Sponsor</span>
                <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
              </a>
            </div>
          )}

          {/* Interactive State Area */}
          <div>
            {isDone ? (
              <div className="py-2 text-center space-y-1">
                <div className="w-8 h-8 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="text-xs font-semibold text-emerald-400">
                  Verification Complete
                </div>
                <div className="text-[11px] text-zinc-400">
                  Starting download…
                </div>
              </div>
            ) : (
              <div className="space-y-2 py-1">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                    <span>Verifying…</span>
                  </span>
                  <span className="font-mono text-zinc-300 font-semibold">
                    {secondsLeft}s
                  </span>
                </div>

                {/* Progress Track */}
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden relative">
                  <motion.div
                    className="h-full bg-brand-500 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
