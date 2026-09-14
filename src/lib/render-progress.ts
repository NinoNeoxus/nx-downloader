/**
 * Real-time render and download progress tracker + cancellation manager.
 * Allows client-side progress bars to track server-side stream downloads and FFmpeg merging,
 * and immediately terminates downloads/FFmpeg tasks when a user refreshes or leaves.
 */

import fs from 'fs';

export interface RenderProgressData {
  renderId: string;
  stage: 'downloading' | 'merging' | 'ready' | 'error';
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  speed?: string;
  message: string;
  updatedAt: number;
  error?: string;
  filePath?: string;
  contentType?: string;
  filename?: string;
  ext?: string;
  downloadUrl?: string;
}

export interface RenderSession {
  renderId: string;
  abortController: AbortController;
  lastHeartbeat: number;
  tempFiles: Set<string>;
  createdAt: number;
  clientIp?: string;
}

// ── Singleton Maps on globalThis: survives Next.js dev-mode hot-reloads ──────

declare global {
  // eslint-disable-next-line no-var
  var __neoxus_render_progress_map__: Map<string, RenderProgressData> | undefined;
  // eslint-disable-next-line no-var
  var __neoxus_render_sessions__: Map<string, RenderSession> | undefined;
  // eslint-disable-next-line no-var
  var __neoxus_render_progress_timer__: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __neoxus_render_watchdog_timer__: ReturnType<typeof setInterval> | undefined;
}

if (!globalThis.__neoxus_render_progress_map__) {
  globalThis.__neoxus_render_progress_map__ = new Map<string, RenderProgressData>();
}
const progressMap = globalThis.__neoxus_render_progress_map__;

if (!globalThis.__neoxus_render_sessions__) {
  globalThis.__neoxus_render_sessions__ = new Map<string, RenderSession>();
}
const sessionMap = globalThis.__neoxus_render_sessions__;

// ── Auto-cleanup stale entries older than 30 minutes ───────────────────────
const TTL_MS = 30 * 60 * 1000;
if (!globalThis.__neoxus_render_progress_timer__) {
  globalThis.__neoxus_render_progress_timer__ = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of progressMap.entries()) {
      if (now - entry.updatedAt > TTL_MS) {
        if (entry.filePath && fs.existsSync(entry.filePath)) {
          try {
            fs.unlinkSync(entry.filePath);
          } catch {}
        }
        progressMap.delete(id);
      }
    }
  }, 60 * 1000);
  globalThis.__neoxus_render_progress_timer__.unref();
}

// ── Client Inactivity Heartbeat Watchdog ───────────────────────────────────
// Clients poll /api/render-progress every 400ms.
// If the client refreshes, navigates away, or closes the tab, polling immediately stops.
// If > 6000ms pass without a single poll during 'downloading' or 'merging',
// we abort the server render task immediately to prevent ghost CPU/RAM/bandwidth waste.
const HEARTBEAT_TIMEOUT_MS = 6000;
if (!globalThis.__neoxus_render_watchdog_timer__) {
  globalThis.__neoxus_render_watchdog_timer__ = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessionMap.entries()) {
      const progress = progressMap.get(id);
      // Only watchdog active downloading/merging tasks
      if (progress && (progress.stage === 'downloading' || progress.stage === 'merging')) {
        const elapsed = now - session.lastHeartbeat;
        if (elapsed > HEARTBEAT_TIMEOUT_MS) {
          console.warn(
            `[RenderWatchdog] Client lost for renderId=${id} (${Math.round(elapsed / 1000)}s without heartbeat). Cancelling task.`
          );
          cancelRenderSession(id, `Klien terputus (tidak ada aktivitas selama ${Math.round(elapsed / 1000)} detik)`);
        }
      } else if (!progress || progress.stage === 'error') {
        sessionMap.delete(id);
      }
    }
  }, 2000);
  globalThis.__neoxus_render_watchdog_timer__.unref();
}

// ── Progress Tracker Methods ───────────────────────────────────────────────

export function setRenderProgress(
  renderId: string,
  data: Partial<Omit<RenderProgressData, 'renderId' | 'updatedAt'>>
): void {
  if (!renderId) return;
  const existing = progressMap.get(renderId) || {
    renderId,
    stage: 'downloading',
    percent: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    message: 'Starting render…',
    updatedAt: Date.now(),
  };

  progressMap.set(renderId, {
    ...existing,
    ...data,
    renderId,
    updatedAt: Date.now(),
  });
}

export function getRenderProgress(renderId: string): RenderProgressData | null {
  if (!renderId) return null;
  return progressMap.get(renderId) || null;
}

export function deleteRenderProgress(renderId: string): void {
  if (!renderId) return;
  progressMap.delete(renderId);
}

// ── Render Session & Abort Lifecycle ───────────────────────────────────────

export function createRenderSession(renderId: string, clientIp?: string) {
  if (!renderId) throw new Error('renderId is required');

  // If a previous session with same renderId exists, cancel it first
  if (sessionMap.has(renderId)) {
    cancelRenderSession(renderId, 'Digantikan oleh proses unduh baru');
  }

  const controller = new AbortController();
  const tempFiles = new Set<string>();

  const session: RenderSession = {
    renderId,
    abortController: controller,
    lastHeartbeat: Date.now(),
    tempFiles,
    createdAt: Date.now(),
    clientIp,
  };

  sessionMap.set(renderId, session);

  const abort = (reason?: string) => {
    cancelRenderSession(renderId, reason);
  };

  const addTempFile = (filePath: string) => {
    if (filePath) tempFiles.add(filePath);
  };

  const removeTempFile = (filePath: string) => {
    if (filePath) tempFiles.delete(filePath);
  };

  const isAborted = () => controller.signal.aborted;

  return {
    signal: controller.signal,
    abort,
    addTempFile,
    removeTempFile,
    isAborted,
  };
}

export function touchRenderHeartbeat(renderId: string): void {
  if (!renderId) return;
  const session = sessionMap.get(renderId);
  if (session) {
    session.lastHeartbeat = Date.now();
  }
}

export function cancelRenderSession(renderId: string, reason = 'Klien merefresh atau menutup browser'): boolean {
  if (!renderId) return false;
  const session = sessionMap.get(renderId);
  if (!session) return false;

  console.log(`[RenderManager] Membatalkan sesi render ${renderId}: ${reason}`);

  // 1. Fire abort signal immediately
  if (!session.abortController.signal.aborted) {
    try {
      session.abortController.abort(new Error(reason));
    } catch {}
  }

  // 2. Unlink and purge any registered temporary files on disk
  for (const file of session.tempFiles) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`[RenderManager] File sementara berhasil dibersihkan: ${file}`);
      }
    } catch (err) {
      console.error(`[RenderManager] Gagal menghapus file sementara ${file}:`, err);
    }
  }
  session.tempFiles.clear();

  // 3. Mark progress as error / cancelled if not already ready
  const existing = progressMap.get(renderId);
  if (existing && existing.stage !== 'ready') {
    progressMap.set(renderId, {
      ...existing,
      stage: 'error',
      percent: 0,
      message: 'Unduhan dibatalkan karena halaman direfresh atau ditutup.',
      error: reason,
      updatedAt: Date.now(),
    });
  }

  // 4. Remove session
  sessionMap.delete(renderId);
  return true;
}

export function endRenderSession(renderId: string): void {
  if (!renderId) return;
  sessionMap.delete(renderId);
}

export function getRenderSession(renderId: string): RenderSession | undefined {
  if (!renderId) return undefined;
  return sessionMap.get(renderId);
}
