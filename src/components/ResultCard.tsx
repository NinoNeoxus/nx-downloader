'use client';

import { useState, useMemo, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  Music,
  Film,
  Clock,
  User,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileText,
  VolumeX,
  Sparkles,
  CheckCircle2,
  Info,
  Loader2,
  AlertCircle,
  Zap,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { MediaMetadata, AvailableFormat, SubtitleOption } from '@/types/media';
import { PlatformBadge } from '@/components/ui/PlatformIcon';
import { AdGateModal } from '@/components/AdGateModal';
import { SITE_CONFIG } from '@/lib/config';

// ─── Format Size Parser for Ad Gate (>200MB) ────────────────────────────────
export function parseSizeToMB(sizeStr?: string, durationSec?: number): number {
  if (sizeStr) {
    const match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB|B)/i);
    if (match) {
      const val = parseFloat(match[1]);
      if (!isNaN(val)) {
        const unit = match[2].toUpperCase();
        if (unit === 'GB') return val * 1024;
        if (unit === 'MB') return val;
        if (unit === 'KB') return val / 1024;
        return val / (1024 * 1024);
      }
    }
  }
  // Fallback: estimate from duration (a standard 720p/1080p stream is ~12 MB/min)
  if (durationSec && durationSec > 0) {
    return (durationSec / 60) * 12;
  }
  return 0;
}

// ─── Active Render Tracker for Instant Page Refresh / Unload Cancellation ───
const activeRenderIds = new Set<string>();

if (typeof window !== 'undefined') {
  const cancelAllActiveDownloads = () => {
    for (const id of activeRenderIds) {
      const cancelUrl = `/api/render-progress?action=cancel&renderId=${encodeURIComponent(id)}`;
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(cancelUrl);
      } else {
        fetch(cancelUrl, { method: 'POST', keepalive: true }).catch(() => {});
      }
    }
  };

  window.addEventListener('beforeunload', cancelAllActiveDownloads);
  window.addEventListener('pagehide', cancelAllActiveDownloads);
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface ResultCardProps {
  metadata: MediaMetadata;
  className?: string;
}

// ─── Stream Download with Real-Time Progress ────────────────────────────────

export interface StreamProgress {
  stage: 'downloading' | 'merging' | 'saving' | 'ready' | 'error';
  percent: number;
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

function formatDownloadBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function pollRenderProgress(
  renderId: string,
  onProgress: (p: StreamProgress) => void
): () => void {
  let active = true;

  const check = async () => {
    if (!active) return;
    try {
      const res = await fetch(`/api/render-progress?renderId=${encodeURIComponent(renderId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!active) return;
      if (data && data.success && data.progress) {
        onProgress({
          stage: data.progress.stage,
          percent: data.progress.percent,
          message: data.progress.message,
          downloadedBytes: data.progress.downloadedBytes,
          totalBytes: data.progress.totalBytes,
        });
      }
    } catch {}
  };

  const intervalId = setInterval(check, 400);
  check();

  return () => {
    active = false;
    clearInterval(intervalId);
  };
}

async function performStreamDownload({
  url,
  filename,
  ext,
  requiresRender,
  renderId,
  onProgress,
  cancelSignal,
}: {
  url: string;
  filename: string;
  ext: string;
  requiresRender?: boolean;
  renderId?: string;
  onProgress?: (p: StreamProgress) => void;
  cancelSignal?: AbortSignal;
}): Promise<void> {
  // If this format requires rendering / preparation with renderId tracking
  if (renderId && requiresRender) {
    activeRenderIds.add(renderId);

    // Phase 1: Request background render task without holding download socket open
    const prepareUrl = url.includes('?') ? `${url}&action=prepare` : `${url}?action=prepare`;
    const prepRes = await fetch(prepareUrl);
    if (!prepRes.ok) {
      activeRenderIds.delete(renderId);
      let errMsg = 'Gagal memulai penyiapan video';
      try {
        const errJson = await prepRes.json();
        if (errJson.error) errMsg = errJson.error;
      } catch {}
      throw new Error(errMsg);
    }

    return new Promise<void>((resolve, reject) => {
      let isDone = false;
      let lastActivityTime = Date.now();
      const startTime = Date.now();

      let watchdogInterval: NodeJS.Timeout | null = null;
      const cleanup = () => {
        if (watchdogInterval) clearInterval(watchdogInterval);
        activeRenderIds.delete(renderId);
      };

      const handleUserCancel = () => {
        if (isDone) return;
        isDone = true;
        cleanup();
        stopPolling();
        activeRenderIds.delete(renderId);
        // Instantly notify backend to abort downloads & kill ffmpeg processes
        const cancelUrl = `/api/render-progress?action=cancel&renderId=${encodeURIComponent(renderId)}`;
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          navigator.sendBeacon(cancelUrl);
        } else {
          fetch(cancelUrl, { method: 'POST', keepalive: true }).catch(() => {});
        }
        reject(new Error('USER_CANCELLED'));
      };

      if (cancelSignal?.aborted) {
        handleUserCancel();
        return;
      }

      cancelSignal?.addEventListener('abort', handleUserCancel, { once: true });

      const stopPolling = pollRenderProgress(renderId, (p) => {
        if (isDone) return;
        lastActivityTime = Date.now();
        onProgress?.(p);

        if (p.stage === 'ready' || p.percent >= 100) {
          isDone = true;
          cleanup();
          stopPolling();
          cancelSignal?.removeEventListener('abort', handleUserCancel);

          // Phase 2: File is completely rendered on server disk — trigger instant browser download
          const readyDownloadUrl =
            (p as { downloadUrl?: string }).downloadUrl ||
            `/api/stream?action=download&renderId=${encodeURIComponent(renderId)}&filename=${encodeURIComponent(filename)}&ext=${encodeURIComponent(ext)}`;

          const a = document.createElement('a');
          a.href = readyDownloadUrl;
          a.download = `${filename}.${ext}`;
          a.rel = 'noopener noreferrer';
          document.body.appendChild(a);
          a.click();
          a.remove();

          onProgress?.({
            stage: 'ready',
            percent: 100,
            message: 'Unduhan selesai! File tersimpan di folder Download.',
          });
          resolve();
        } else if (p.stage === 'error') {
          isDone = true;
          cleanup();
          stopPolling();
          cancelSignal?.removeEventListener('abort', handleUserCancel);
          reject(new Error(p.message || 'Gagal mengunduh file'));
        }
      });

      // Inactivity Watchdog: Only time out if the server stops updating for 5 continuous minutes.
      watchdogInterval = setInterval(() => {
        if (isDone) {
          cleanup();
          return;
        }
        const now = Date.now();
        const inactiveMs = now - lastActivityTime;
        const totalElapsedMs = now - startTime;

        if (inactiveMs > 5 * 60 * 1000) {
          isDone = true;
          cleanup();
          stopPolling();
          cancelSignal?.removeEventListener('abort', handleUserCancel);
          reject(new Error('Server tidak mengirim pembaruan status selama lebih dari 5 menit. Silakan coba lagi.'));
        } else if (totalElapsedMs > 60 * 60 * 1000) {
          isDone = true;
          cleanup();
          stopPolling();
          cancelSignal?.removeEventListener('abort', handleUserCancel);
          reject(new Error('Batas waktu maksimal penyiapan file habis (60 menit).'));
        }
      }, 10 * 1000);
    });
  }

  // Direct progressive download (no rendering needed, streams immediately)
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${ext}`;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();

  // For direct single-stream formats (e.g. 720p, direct audio)
  onProgress?.({
    stage: 'downloading',
    percent: 60,
    message: 'Video Anda sedang diunduh secara otomatis…',
  });

  await new Promise<void>((resolve) => {
    setTimeout(() => {
      onProgress?.({
        stage: 'ready',
        percent: 100,
        message: 'Unduhan selesai! File tersimpan di folder Download.',
      });
      resolve();
    }, 700);
  });
}

// ─── Active Progress Bar Component ──────────────────────────────────────────

function ActiveProgressBar({
  progress,
  accent = 'brand',
  type = 'video',
  onCancel,
}: {
  progress: StreamProgress;
  accent?: 'brand' | 'sky';
  type?: 'video' | 'audio';
  onCancel?: () => void;
}) {
  const isReady = progress.stage === 'ready';
  const isError = progress.stage === 'error';
  const pct = Math.max(2, Math.min(100, progress.percent));

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -6, height: 0 }}
      transition={{ duration: 0.25 }}
      className="overflow-hidden pt-1"
    >
      <div
        className={cn(
          'p-3 rounded-xl border shadow-inner space-y-2',
          isError
            ? 'bg-red-950/40 border-red-500/30 text-red-300'
            : isReady
            ? 'bg-emerald-950/40 border-emerald-500/30'
            : accent === 'sky'
            ? 'bg-sky-950/30 border-sky-500/30'
            : 'bg-brand-950/30 border-brand-500/30'
        )}
      >
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-medium text-zinc-200 truncate pr-2">
            {isError ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : isReady ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Loader2
                className={cn(
                  'w-4 h-4 animate-spin shrink-0',
                  accent === 'sky' ? 'text-sky-400' : 'text-brand-400'
                )}
              />
            )}
            <span className="truncate">{progress.message || (isReady ? 'Unduhan selesai!' : 'Memproses…')}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isReady && !isError && onCancel && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onCancel();
                }}
                className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-colors flex items-center gap-1 cursor-pointer"
                title="Batalkan proses unduh di server"
              >
                <X className="w-3 h-3 text-red-400" />
                <span>Batal</span>
              </button>
            )}
            <span
              className={cn(
                'font-mono font-bold shrink-0',
                isError
                  ? 'text-red-400'
                  : isReady
                  ? 'text-emerald-400'
                  : accent === 'sky'
                  ? 'text-sky-400'
                  : 'text-brand-400'
              )}
            >
              {isError ? 'Gagal' : `${progress.percent}%`}
            </span>
          </div>
        </div>

        {/* Progress Track */}
        <div className="relative w-full h-2 rounded-full bg-zinc-800/80 overflow-hidden">
          <motion.div
            className={cn(
              'h-full rounded-full transition-all duration-300 ease-out',
              isError
                ? 'bg-red-500'
                : isReady
                ? 'bg-emerald-500'
                : accent === 'sky'
                ? 'bg-gradient-to-r from-sky-500 via-teal-400 to-emerald-400'
                : 'bg-gradient-to-r from-brand-500 via-indigo-500 to-cyan-400'
            )}
            style={{ width: `${pct}%` }}
          />
          {!isReady && !isError && (
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-shimmer" />
          )}
        </div>

        {/* Sub-label showing friendly status */}
        <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-0.5">
          <span className="text-zinc-400 truncate pr-2">
            {type === 'audio'
              ? progress.stage === 'downloading'
                ? 'Audio Anda sedang diunduh secara otomatis…'
                : progress.stage === 'merging'
                ? 'Sedang memproses & merapikan audio…'
                : progress.stage === 'saving'
                ? 'Menyimpan ke folder Download Anda…'
                : isError
                ? 'Gagal memproses audio'
                : 'Unduhan audio selesai! File tersimpan di folder Download.'
              : progress.stage === 'downloading'
              ? 'Video Anda sedang diunduh secara otomatis…'
              : progress.stage === 'merging'
              ? 'Sedang merender video kualitas terbaik…'
              : progress.stage === 'saving'
              ? 'Menyimpan ke folder Download Anda…'
              : isError
              ? 'Gagal mengunduh file'
              : 'Unduhan selesai! File tersimpan di folder Download.'}
          </span>
          {progress.totalBytes && progress.totalBytes > 0 && progress.downloadedBytes ? (
            <span className="font-mono text-zinc-300 font-medium shrink-0">
              {formatDownloadBytes(progress.downloadedBytes)} / {formatDownloadBytes(progress.totalBytes)}
            </span>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

// ─── Thumbnail Component ────────────────────────────────────────────────────

function Thumbnail({ src, title }: { src: string; title: string }) {
  return (
    <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800/80 group/thumb">
      {src ? (
        <Image
          src={src}
          alt={`Thumbnail for ${title}`}
          fill
          className="object-cover transition-transform duration-500 ease-out group-hover/thumb:scale-105"
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center">
            <ExternalLink className="w-5 h-5 text-zinc-500" />
          </div>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none" />
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ResultCard({ metadata, className }: ResultCardProps) {
  const {
    title,
    author,
    thumbnail,
    duration,
    platform,
    description,
    availableFormats: propAvailableFormats,
    subtitles,
    downloadUrl,
    audioUrl,
    quality,
    audioQuality,
  } = metadata;

  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [downloadingSection, setDownloadingSection] = useState<string | null>(null);
  const [downloadProgressText, setDownloadProgressText] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<StreamProgress | null>(null);
  const [audioProgress, setAudioProgress] = useState<StreamProgress | null>(null);

  // Parse duration in seconds for accurate size estimation
  const durationInSeconds = useMemo(() => {
    if (!duration) return 0;
    const parts = duration.split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }, [duration]);

  // Derive sanitized filename
  const safeTitle =
    title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'download';

  // Build unified AvailableFormat list
  const formats: AvailableFormat[] = useMemo(() => {
    if (propAvailableFormats && propAvailableFormats.length > 0) {
      return propAvailableFormats;
    }

    // Fallback for adapters without availableFormats
    const fallbackList: AvailableFormat[] = [];
    if (downloadUrl) {
      fallbackList.push({
        id: 'default_video',
        ext: 'mp4',
        quality: `${quality ?? '720p'} • MP4 (H.264 + AAC)`,
        type: 'video+audio',
        size: 'Best Quality',
        formatUrl: downloadUrl,
        requiresRender: false,
        vcodec: 'H.264',
        acodec: 'AAC',
        codecLabel: 'H.264 + AAC',
      });
    }
    if (audioUrl) {
      fallbackList.push({
        id: 'default_audio',
        ext: 'm4a',
        quality: `${audioQuality ?? '128kbps'} • M4A`,
        type: 'audio-only',
        size: 'High Quality',
        formatUrl: audioUrl,
        requiresRender: false,
        acodec: 'AAC',
        codecLabel: 'AAC',
      });
    }
    return fallbackList;
  }, [propAvailableFormats, downloadUrl, audioUrl, quality, audioQuality]);

  // All video formats (progressive + DASH merged on the fly)
  const videoFormats = useMemo(
    () => formats.filter((f) => f.type === 'video+audio' || f.type === 'video-only'),
    [formats]
  );

  // Audio formats (guaranteed at least 1 option)
  const audioFormats = useMemo(() => {
    const list = formats.filter((f) => f.type === 'audio-only');
    if (list.length > 0) return list;

    return [
      {
        id: 'default_audio',
        ext: 'm4a',
        quality: '128kbps • M4A',
        type: 'audio-only' as const,
        size: 'Extracted Audio',
        formatUrl:
          audioUrl ||
          `/api/stream?url=${encodeURIComponent(downloadUrl ?? '')}&platform=${platform}&audioOnly=true`,
        requiresRender: false,
      },
    ];
  }, [formats, audioUrl, downloadUrl, platform]);

  // Selected format states for each dropdown
  const [selectedVideo, setSelectedVideo] = useState<string>(
    videoFormats[0]?.id ?? ''
  );
  const [selectedAudio, setSelectedAudio] = useState<string>(
    audioFormats[0]?.id ?? ''
  );
  const [selectedSubtitle, setSelectedSubtitle] = useState<string>(
    subtitles?.[0]?.url ?? ''
  );

  // Abort controller refs for user-triggered cancellations
  const videoCancelControllerRef = useRef<AbortController | null>(null);
  const audioCancelControllerRef = useRef<AbortController | null>(null);

  // Sync default selections when metadata changes
  useMemo(() => {
    if (videoFormats[0]) setSelectedVideo(videoFormats[0].id);
    if (audioFormats[0]) setSelectedAudio(audioFormats[0].id);
    if (subtitles?.[0]) setSelectedSubtitle(subtitles[0].url);
  }, [videoFormats, audioFormats, subtitles]);

  // Currently selected video format object
  const currentVideoFormat = useMemo(() => {
    return videoFormats.find((f) => f.id === selectedVideo) || videoFormats[0];
  }, [videoFormats, selectedVideo]);

  // Currently selected audio format object
  const currentAudioFormat = useMemo(() => {
    return audioFormats.find((f) => f.id === selectedAudio) || audioFormats[0];
  }, [audioFormats, selectedAudio]);

  // ─── Ad Gate States for Monetag (>200MB Requirement) ──────────────────────
  const [verifiedFormatIds, setVerifiedFormatIds] = useState<Set<string>>(new Set());
  const [adGateFormat, setAdGateFormat] = useState<AvailableFormat | null>(null);
  const [isAdGateOpen, setIsAdGateOpen] = useState(false);

  // ─── Direct Download Execution Functions ──────────────────────────────────
  const executeDownloadVideo = async (chosen: AvailableFormat) => {
    const renderId = chosen.requiresRender
      ? `render_v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      : undefined;

    const cancelController = new AbortController();
    videoCancelControllerRef.current = cancelController;

    setDownloadingSection('video');
    setVideoProgress({
      stage: 'downloading',
      percent: 1,
      message: 'Video Anda sedang diunduh secara otomatis…',
    });

    const toastId = toast.loading('Sedang menyiapkan video Anda…', {
      description: `${safeTitle}.${chosen.ext} (${chosen.quality})`,
    });

    const downloadUrl = renderId
      ? chosen.formatUrl.includes('?')
        ? `${chosen.formatUrl}&renderId=${renderId}`
        : `${chosen.formatUrl}?renderId=${renderId}`
      : chosen.formatUrl;

    try {
      await performStreamDownload({
        url: downloadUrl,
        filename: safeTitle,
        ext: chosen.ext,
        requiresRender: chosen.requiresRender,
        renderId,
        cancelSignal: cancelController.signal,
        onProgress: (p) => {
          setVideoProgress(p);
          if (p.totalBytes && p.downloadedBytes) {
            setDownloadProgressText(`${p.percent}% (${formatDownloadBytes(p.downloadedBytes)})`);
          } else {
            setDownloadProgressText(`${p.percent}%`);
          }
        },
      });

      toast.success('Unduhan Selesai!', {
        id: toastId,
        description: `${safeTitle}.${chosen.ext} berhasil diunduh ke folder Download.`,
      });

      setTimeout(() => {
        setVideoProgress(null);
      }, 4000);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'USER_CANCELLED') {
        toast.dismiss(toastId);
        toast.info('Unduhan dibatalkan');
        setVideoProgress(null);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Gagal mengunduh video. Silakan coba lagi.';
      toast.error('Gagal mengunduh', {
        id: toastId,
        description: msg,
      });
      setVideoProgress({
        stage: 'error',
        percent: 0,
        message: msg,
      });
      setTimeout(() => {
        setVideoProgress(null);
      }, 5000);
    } finally {
      videoCancelControllerRef.current = null;
      setDownloadingSection(null);
      setDownloadProgressText(null);
    }
  };

  const executeDownloadAudio = async (chosen: AvailableFormat) => {
    const isRenderRequired =
      chosen.requiresRender ||
      chosen.ext === 'mp3' ||
      chosen.ext === 'm4a' ||
      chosen.ext === 'aac' ||
      chosen.ext === 'webm' ||
      chosen.type === 'audio-only' ||
      platform === 'youtube';

    const renderId = isRenderRequired
      ? `render_a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      : undefined;

    const cancelController = new AbortController();
    audioCancelControllerRef.current = cancelController;

    setDownloadingSection('audio');
    setAudioProgress({
      stage: 'downloading',
      percent: 1,
      message: 'Audio Anda sedang diunduh secara otomatis…',
    });

    const toastId = toast.loading('Sedang menyiapkan audio Anda…', {
      description: `${safeTitle}.${chosen.ext} · ${chosen.quality}`,
    });

    const downloadUrl = renderId
      ? chosen.formatUrl.includes('?')
        ? `${chosen.formatUrl}&renderId=${renderId}`
        : `${chosen.formatUrl}?renderId=${renderId}`
      : chosen.formatUrl;

    try {
      await performStreamDownload({
        url: downloadUrl,
        filename: safeTitle,
        ext: chosen.ext,
        requiresRender: isRenderRequired,
        renderId,
        cancelSignal: cancelController.signal,
        onProgress: (p) => {
          setAudioProgress(p);
          if (p.totalBytes && p.downloadedBytes) {
            setDownloadProgressText(`${p.percent}% (${formatDownloadBytes(p.downloadedBytes)})`);
          } else {
            setDownloadProgressText(`${p.percent}%`);
          }
        },
      });

      toast.success('Audio Berhasil Diunduh!', {
        id: toastId,
        description: `${safeTitle}.${chosen.ext} tersimpan di folder Download.`,
      });

      setTimeout(() => {
        setAudioProgress(null);
      }, 4000);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'USER_CANCELLED') {
        toast.dismiss(toastId);
        toast.info('Unduhan dibatalkan');
        setAudioProgress(null);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Gagal mengunduh audio.';
      toast.error('Gagal mengunduh audio', {
        id: toastId,
        description: msg,
      });
      setAudioProgress({
        stage: 'error',
        percent: 0,
        message: msg,
      });
      setTimeout(() => {
        setAudioProgress(null);
      }, 5000);
    } finally {
      audioCancelControllerRef.current = null;
      setDownloadingSection(null);
      setDownloadProgressText(null);
    }
  };

  // ─── Download Triggers (Optional Configurable Ad-Gate) ─────────────────────
  const handleDownloadVideo = () => {
    const chosen = currentVideoFormat;
    if (!chosen) return;

    if (SITE_CONFIG.adGate.enabled && SITE_CONFIG.adGate.directUrl) {
      const sizeMB = parseSizeToMB(chosen.size, durationInSeconds);
      if (sizeMB > 200 && !verifiedFormatIds.has(chosen.id)) {
        if (typeof window !== 'undefined') {
          window.open(SITE_CONFIG.adGate.directUrl, '_blank', 'noopener,noreferrer');
        }
        setAdGateFormat(chosen);
        setIsAdGateOpen(true);
        return;
      }
    }

    executeDownloadVideo(chosen);
  };

  const handleDownloadAudio = () => {
    const chosen =
      audioFormats.find((f) => f.id === selectedAudio) || audioFormats[0];
    if (!chosen) return;

    if (SITE_CONFIG.adGate.enabled && SITE_CONFIG.adGate.directUrl) {
      const sizeMB = parseSizeToMB(chosen.size, durationInSeconds);
      if (sizeMB > 100 && !verifiedFormatIds.has(chosen.id)) {
        if (typeof window !== 'undefined') {
          window.open(SITE_CONFIG.adGate.directUrl, '_blank', 'noopener,noreferrer');
        }
        setAdGateFormat(chosen);
        setIsAdGateOpen(true);
        return;
      }
    }

    executeDownloadAudio(chosen);
  };

  const handleDownloadSubtitle = async () => {
    const chosen = subtitles?.find((s) => s.url === selectedSubtitle) || subtitles?.[0];
    if (!chosen) return;

    setDownloadingSection('subtitle');
    const toastId = toast.loading('Mengunduh subtitle…', {
      description: `${safeTitle} · ${chosen.lang}`,
    });

    try {
      await performStreamDownload({
        url: chosen.url,
        filename: `${safeTitle}_${chosen.lang.replace(/\s+/g, '_')}`,
        ext: 'vtt',
      });
      toast.success('Subtitle Berhasil Diunduh!', {
        id: toastId,
        description: `${chosen.lang} tersimpan di folder Download.`,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'USER_CANCELLED') {
        toast.dismiss(toastId);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Gagal mengunduh subtitle.';
      toast.error('Gagal mengunduh', {
        id: toastId,
        description: msg,
      });
    } finally {
      setDownloadingSection(null);
    }
  };

  return (
    <div
      className={cn(
        'w-full max-w-2xl mx-auto',
        'rounded-2xl border border-zinc-800/90 bg-zinc-900/90 backdrop-blur-xl',
        'shadow-[0_20px_50px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)]',
        'overflow-hidden',
        className,
      )}
    >
      {/* ── Header: Thumbnail & Badges ───────────────────────────────────── */}
      <div className="relative p-5 pb-0">
        <Thumbnail src={thumbnail} title={title} />

        {/* Duration badge */}
        {duration && (
          <div className="absolute bottom-3 right-8 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/80 backdrop-blur-md border border-white/10 shadow-md">
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <span className="text-xs text-zinc-200 font-mono tracking-tight font-medium">
              {duration}
            </span>
          </div>
        )}

        {/* Platform badge */}
        <div className="absolute top-8 left-8">
          <PlatformBadge platform={platform} />
        </div>
      </div>

      {/* ── Metadata Info ──────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-2 space-y-1.5">
        <h2
          className="text-base sm:text-lg font-semibold text-zinc-100 leading-snug selection:bg-brand-500/20"
          title={title}
        >
          {title}
        </h2>

        {author && (
          <div className="flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
            <User className="w-3.5 h-3.5 text-zinc-500" />
            <span className="truncate">{author}</span>
          </div>
        )}

        {/* Description with Show More / Show Less Toggle */}
        {description && (
          <div className="pt-2">
            <div className="text-xs text-zinc-400 leading-relaxed relative font-normal">
              <AnimatePresence initial={false}>
                {isDescriptionExpanded ? (
                  <motion.p
                    key="expanded"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="whitespace-pre-line text-zinc-300"
                  >
                    {description}
                  </motion.p>
                ) : (
                  <motion.p
                    key="collapsed"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="line-clamp-2 text-zinc-400"
                  >
                    {description}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            <button
              onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-400 hover:text-brand-300 transition-colors"
            >
              <span>{isDescriptionExpanded ? 'Tampilkan Lebih Sedikit' : 'Selengkapnya'}</span>
              {isDescriptionExpanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* ── Divider ────────────────────────────────────────────────────── */}
      <div className="mx-5 my-2 border-t border-zinc-800/80" />

      {/* ── Format Selectors (Dropdowns + Action Buttons) ──────────────── */}
      <div className="px-5 py-4 space-y-4">
        {/* Section Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-300 tracking-wider uppercase flex items-center gap-1.5 font-mono">
            <Film className="w-3.5 h-3.5 text-brand-400" />
            Media Stream Options
          </span>
          <span className="text-[11px] text-zinc-500 font-mono">
            {formats.length} streams
          </span>
        </div>

        {/* ── 1. Video Quality Dropdown ─────────────────────────────── */}
        {videoFormats.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-emerald-400" />
                <span>Video Stream</span>
              </label>
              <div className="flex items-center gap-1.5">
                {currentVideoFormat?.codecLabel && (
                  <span className="text-[10px] font-mono font-medium tracking-wide uppercase px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
                    {currentVideoFormat.codecLabel}
                  </span>
                )}
                <span className="text-[10px] font-mono tracking-wide uppercase px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                  {currentVideoFormat?.requiresRender ? 'Muxed' : 'Direct'}
                </span>
                {SITE_CONFIG.adGate.enabled && !!SITE_CONFIG.adGate.directUrl && parseSizeToMB(currentVideoFormat?.size, durationInSeconds) > 200 && (
                  <span className="text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    AD
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  value={selectedVideo}
                  onChange={(e) => setSelectedVideo(e.target.value)}
                  className="w-full bg-zinc-950/80 border border-zinc-700/70 hover:border-zinc-600 focus:border-brand-500 text-zinc-100 text-xs sm:text-sm rounded-xl px-3.5 py-2.5 outline-none transition-colors cursor-pointer appearance-none pr-8 shadow-inner font-medium font-mono"
                >
                  {videoFormats.map((f) => {
                    const isAdRequired = SITE_CONFIG.adGate.enabled && !!SITE_CONFIG.adGate.directUrl && parseSizeToMB(f.size, durationInSeconds) > 200;
                    return (
                      <option key={f.id} value={f.id} className="bg-zinc-900 text-zinc-100 font-sans">
                        {f.quality} — {f.size} {isAdRequired ? '[AD]' : ''}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              <button
                onClick={handleDownloadVideo}
                disabled={downloadingSection === 'video'}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shrink-0 transition-all duration-200',
                  'bg-brand-500 hover:bg-brand-400 text-white shadow-glow-sm hover:shadow-glow-md active:scale-95',
                  downloadingSection === 'video' && 'opacity-80 cursor-wait'
                )}
              >
                {downloadingSection === 'video' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span className="font-mono text-xs font-semibold">{downloadProgressText || 'Downloading…'}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download Video</span>
                    {SITE_CONFIG.adGate.enabled && !!SITE_CONFIG.adGate.directUrl && parseSizeToMB(currentVideoFormat?.size, durationInSeconds) > 200 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-zinc-950/50 text-amber-300 border border-amber-400/40 tracking-wider">
                        AD
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>

            {/* Live Animated Progress Bar for Video Rendering / Transfer */}
            <AnimatePresence>
              {videoProgress && (
                <ActiveProgressBar
                  progress={videoProgress}
                  accent="brand"
                  type="video"
                  onCancel={() => videoCancelControllerRef.current?.abort()}
                />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── 2. Audio Formats Dropdown ───────────────────────────────── */}
        {audioFormats.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                <Music className="w-3.5 h-3.5 text-sky-400" />
                <span>Audio Stream</span>
              </label>
              <div className="flex items-center gap-1.5">
                {currentAudioFormat?.codecLabel && (
                  <span className="text-[10px] font-mono font-medium tracking-wide uppercase px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-300 border border-sky-500/25">
                    {currentAudioFormat.codecLabel}
                  </span>
                )}
                <span className="text-[10px] font-mono tracking-wide uppercase px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                  {currentAudioFormat?.ext === 'mp3' ? 'LAME MP3' : 'Direct Copy'}
                </span>
                {SITE_CONFIG.adGate.enabled && !!SITE_CONFIG.adGate.directUrl && parseSizeToMB(currentAudioFormat?.size, durationInSeconds) > 100 && (
                  <span className="text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    AD
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  value={selectedAudio}
                  onChange={(e) => setSelectedAudio(e.target.value)}
                  className="w-full bg-zinc-950/80 border border-zinc-700/70 hover:border-zinc-600 focus:border-sky-500 text-zinc-100 text-xs sm:text-sm rounded-xl px-3.5 py-2.5 outline-none transition-colors cursor-pointer appearance-none pr-8 shadow-inner font-medium font-mono"
                >
                  {audioFormats.map((f) => {
                    const isAdRequired = SITE_CONFIG.adGate.enabled && !!SITE_CONFIG.adGate.directUrl && parseSizeToMB(f.size, durationInSeconds) > 100;
                    return (
                      <option key={f.id} value={f.id} className="bg-zinc-900 text-zinc-100 font-sans">
                        {f.quality} — {f.size} {isAdRequired ? '[AD]' : ''}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              <button
                onClick={handleDownloadAudio}
                disabled={downloadingSection === 'audio'}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shrink-0',
                  'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 hover:text-white border border-zinc-700 hover:border-zinc-600 active:scale-95 transition-all duration-200',
                  downloadingSection === 'audio' && 'opacity-80 cursor-wait'
                )}
              >
                {downloadingSection === 'audio' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    <span className="font-mono text-xs font-semibold">{downloadProgressText || 'Downloading…'}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download Audio</span>
                    {SITE_CONFIG.adGate.enabled && !!SITE_CONFIG.adGate.directUrl && parseSizeToMB(currentAudioFormat?.size, durationInSeconds) > 100 && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-zinc-950/50 text-amber-300 border border-amber-400/40 tracking-wider">
                        AD
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>

            {/* Live Animated Progress Bar for Audio Rendering / Transfer */}
            <AnimatePresence>
              {audioProgress && (
                <ActiveProgressBar
                  progress={audioProgress}
                  accent="sky"
                  type="audio"
                  onCancel={() => audioCancelControllerRef.current?.abort()}
                />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── 3. Subtitles Dropdown (Captions) ────────────────────────── */}
        {subtitles && subtitles.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              <span>Subtitle ({subtitles.length} bahasa)</span>
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  value={selectedSubtitle}
                  onChange={(e) => setSelectedSubtitle(e.target.value)}
                  className="w-full bg-zinc-950/80 border border-zinc-700/70 hover:border-zinc-600 focus:border-purple-500 text-zinc-100 text-xs sm:text-sm rounded-xl px-3.5 py-2.5 outline-none transition-colors cursor-pointer appearance-none pr-8 shadow-inner font-medium"
                >
                  {subtitles.map((sub, idx) => (
                    <option key={idx} value={sub.url} className="bg-zinc-900 text-zinc-100">
                      {sub.lang}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              <button
                onClick={handleDownloadSubtitle}
                disabled={downloadingSection === 'subtitle'}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shrink-0',
                  'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 hover:text-white border border-zinc-700 hover:border-zinc-600 active:scale-95 transition-all duration-200',
                  downloadingSection === 'subtitle' && 'opacity-80 cursor-wait'
                )}
              >
                {downloadingSection === 'subtitle' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    <span>Mengunduh…</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download Subtitle</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Ad Gate Modal for Files > 200MB (Monetag Integration) ─────── */}
      <AdGateModal
        isOpen={isAdGateOpen}
        format={adGateFormat}
        videoTitle={safeTitle}
        onVerified={() => {
          if (adGateFormat) {
            const fmt = adGateFormat;
            setVerifiedFormatIds((prev) => new Set(prev).add(fmt.id));
            setIsAdGateOpen(false);
            setAdGateFormat(null);
            if (fmt.type === 'audio-only') {
              executeDownloadAudio(fmt);
            } else {
              executeDownloadVideo(fmt);
            }
          }
        }}
        onCancel={() => {
          setIsAdGateOpen(false);
          setAdGateFormat(null);
          toast.info('Unduhan dibatalkan');
        }}
      />
    </div>
  );
}
