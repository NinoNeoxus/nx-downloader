'use client';

import { cn } from '@/lib/utils';

// ─── Shimmer base ─────────────────────────────────────────────────────────

function SkeletonLine({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg bg-zinc-800/80',
        'bg-gradient-to-r from-zinc-800/80 via-zinc-700/40 to-zinc-800/80',
        'bg-[length:200%_100%] animate-shimmer',
        className,
      )}
    />
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

interface LoadingSkeletonProps {
  className?: string;
}

/**
 * Animated skeleton that mirrors the exact layout of ResultCard.
 * Shown during the 'loading' state while the API extracts metadata.
 */
export function LoadingSkeleton({ className }: LoadingSkeletonProps) {
  return (
    <div
      aria-label="Loading video information…"
      aria-busy="true"
      className={cn(
        'w-full max-w-2xl mx-auto animate-fade-in',
        'rounded-2xl border border-zinc-800/80 bg-zinc-900/60',
        className,
      )}
    >
      {/* Thumbnail skeleton */}
      <div className="p-4 pb-0">
        <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-zinc-800/80">
          <SkeletonLine className="absolute inset-0 rounded-xl" />
          {/* Simulated play icon placeholder */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-zinc-700/40 border border-zinc-700/60 flex items-center justify-center">
              <div className="w-5 h-5 rounded-sm bg-zinc-600/50" />
            </div>
          </div>
          {/* Duration badge skeleton */}
          <div className="absolute bottom-3 right-3">
            <SkeletonLine className="w-14 h-5 rounded-md" />
          </div>
          {/* Platform badge skeleton */}
          <div className="absolute top-3 left-3">
            <SkeletonLine className="w-20 h-5 rounded-full" />
          </div>
        </div>
      </div>

      {/* Metadata skeleton */}
      <div className="px-4 pt-4 pb-2 space-y-3">
        <SkeletonLine className="h-4 w-full" />
        <SkeletonLine className="h-4 w-3/4" />
        <SkeletonLine className="h-3 w-1/3" />
      </div>

      {/* Divider */}
      <div className="mx-4 my-3 border-t border-zinc-800/60" />

      {/* Button skeletons */}
      <div className="px-4 pb-4 flex flex-col sm:flex-row gap-2.5">
        <SkeletonLine className="flex-1 h-11 rounded-xl" />
        <SkeletonLine className="flex-1 h-11 rounded-xl" />
      </div>
    </div>
  );
}
