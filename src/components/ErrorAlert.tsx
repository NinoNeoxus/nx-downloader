'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Props ──────────────────────────────────────────────────────────────────

interface ErrorAlertProps {
  message: string;
  onDismiss?: () => void;
  autoDismissMs?: number;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ErrorAlert({
  message,
  onDismiss,
  autoDismissMs = 6000,
  className,
}: ErrorAlertProps) {
  const [visible, setVisible] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);

  const dismiss = () => {
    setIsLeaving(true);
    setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, 300);
  };

  useEffect(() => {
    setVisible(true);
    setIsLeaving(false);

    const timer = setTimeout(dismiss, autoDismissMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, autoDismissMs]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'w-full max-w-2xl mx-auto flex items-start gap-3 p-4 rounded-xl',
        'bg-red-500/8 border border-red-500/25',
        'transition-all duration-300',
        isLeaving ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0 animate-fade-in',
        className,
      )}
    >
      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        <AlertTriangle className="w-4 h-4 text-red-400" />
      </div>

      {/* Message */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-red-300 leading-relaxed">{message}</p>
      </div>

      {/* Dismiss button */}
      {onDismiss && (
        <button
          id="error-dismiss-btn"
          onClick={dismiss}
          className="shrink-0 p-0.5 text-red-500/60 hover:text-red-400 transition-colors rounded"
          aria-label="Dismiss error"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
