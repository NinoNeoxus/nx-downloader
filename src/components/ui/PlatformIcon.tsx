'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Platform } from '@/types/media';

// Brand color definitions per platform
const PLATFORM_CONFIG: Record<
  Platform,
  {
    label: string;
    color: string;        // active text/icon color
    glow: string;         // glow shadow color
    bg: string;           // active badge background
    icon: React.ReactNode;
  }
> = {
  youtube: {
    label: 'YouTube',
    color: 'text-red-500',
    glow: 'shadow-[0_0_14px_3px_rgba(239,68,68,0.35)]',
    bg: 'bg-red-500/10 border-red-500/40',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  tiktok: {
    label: 'TikTok',
    color: 'text-[#ff0050]',
    glow: 'shadow-[0_0_14px_3px_rgba(255,0,80,0.35)]',
    bg: 'bg-[#ff0050]/10 border-[#ff0050]/40',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.15 8.15 0 004.76 1.52V6.76a4.85 4.85 0 01-1-.07z" />
      </svg>
    ),
  },
  instagram: {
    label: 'Instagram',
    color: 'text-[#e1306c]',
    glow: 'shadow-[0_0_14px_3px_rgba(225,48,108,0.35)]',
    bg: 'bg-[#e1306c]/10 border-[#e1306c]/40',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
      </svg>
    ),
  },
  facebook: {
    label: 'Facebook',
    color: 'text-[#1877f2]',
    glow: 'shadow-[0_0_14px_3px_rgba(24,119,242,0.35)]',
    bg: 'bg-[#1877f2]/10 border-[#1877f2]/40',
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
  },
};

// ─── Props ──────────────────────────────────────────────────────────────────

interface PlatformIconProps {
  platform: Platform | null;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PlatformIcon({
  platform,
  active = false,
  size = 'md',
  showLabel = false,
  className,
}: PlatformIconProps) {
  const sizeMap = { sm: 'w-7 h-7', md: 'w-8 h-8', lg: 'w-10 h-10' };

  if (!platform) return null;

  const config = PLATFORM_CONFIG[platform];

  return (
    <motion.div
      initial={false}
      animate={
        active
          ? {
              scale: [1, 1.18, 1.08],
              y: [0, -4, 0],
              transition: {
                duration: 0.4,
                ease: [0.175, 0.885, 0.32, 1.275],
              },
            }
          : {
              scale: 1,
              y: 0,
              transition: { duration: 0.2 },
            }
      }
      whileHover={{ scale: active ? 1.1 : 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={cn(
        'flex items-center gap-2 rounded-xl border transition-colors duration-300 select-none cursor-default',
        sizeMap[size],
        active
          ? [config.color, config.bg, config.glow]
          : 'text-zinc-600 bg-zinc-900/50 border-zinc-800/80 hover:text-zinc-400 hover:border-zinc-700/60',
        showLabel && 'px-3 w-auto',
        className,
      )}
    >
      <span className={cn('flex items-center justify-center', !showLabel && 'mx-auto')}>
        {config.icon}
      </span>
      {showLabel && (
        <span className="text-xs font-semibold tracking-wide whitespace-nowrap">{config.label}</span>
      )}
    </motion.div>
  );
}

// ─── Platform Badge (compact, inline) ──────────────────────────────────────

interface PlatformBadgeProps {
  platform: Platform;
  className?: string;
}

export function PlatformBadge({ platform, className }: PlatformBadgeProps) {
  const config = PLATFORM_CONFIG[platform];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-md',
        config.color,
        config.bg,
        className,
      )}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

// ─── Platform Picker Row (idle state icons) ─────────────────────────────────

interface PlatformRowProps {
  activePlatform: Platform | null;
}

export function PlatformRow({ activePlatform }: PlatformRowProps) {
  const platforms: Platform[] = ['youtube', 'tiktok', 'instagram', 'facebook'];

  return (
    <div className="flex items-center justify-center gap-3 mt-4">
      {platforms.map((p) => (
        <PlatformIcon
          key={p}
          platform={p}
          active={activePlatform === p}
          size="md"
          showLabel={activePlatform === p}
        />
      ))}
    </div>
  );
}

export { PLATFORM_CONFIG };
