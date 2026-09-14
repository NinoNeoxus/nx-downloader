import os from 'os';
import fs from 'fs';
import path from 'path';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface RequestLogEntry {
  id: string;
  timestamp: string;
  ip: string;
  country?: string;
  endpoint: string;
  platform?: string;
  action?: string;
  targetUrl?: string;
  title?: string;
  format?: string;
  statusCode: number;
  durationMs: number;
  bytesTransferred: number;
  userAgent: string;
  isBot?: boolean;
}

export interface PlatformBandwidth {
  youtube: number;
  tiktok: number;
  instagram: number;
  facebook: number;
  other: number;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  totalRequests: number;
  totalBytes: number;
  uniqueIps: number;
  platformBytes: PlatformBandwidth;
  downloadsCount: number;
}

export interface SystemMetrics {
  cpuPercent: number;
  cpuCores: number;
  cpuModel: string;
  ramTotalBytes: number;
  ramFreeBytes: number;
  ramUsedBytes: number;
  ramPercent: number;
  processMemoryRssBytes: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  diskUsedBytes: number;
  diskPercent: number;
  systemUptimeSec: number;
  processUptimeSec: number;
  loadAverage: number[];
  activeRenderTasks: number;
}

// ─── Constants & Paths ──────────────────────────────────────────────────────

const MAX_RING_BUFFER_SIZE = 1000;
const DATA_DIR = path.join(process.cwd(), 'data');
const STATS_FILE = path.join(DATA_DIR, 'traffic-stats.json');

// ─── State ──────────────────────────────────────────────────────────────────

const recentLogs: RequestLogEntry[] = [];
let activeTasksCount = 0;

interface PersistentTrafficLedger {
  allTimeBytes: number;
  allTimeRequests: number;
  allTimeDownloads: number;
  daily: Record<string, DailyStats>;
}

let trafficLedger: PersistentTrafficLedger = {
  allTimeBytes: 0,
  allTimeRequests: 0,
  allTimeDownloads: 0,
  daily: {},
};

// Load saved stats from disk
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(STATS_FILE)) {
    const raw = fs.readFileSync(STATS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      trafficLedger = {
        allTimeBytes: parsed.allTimeBytes || 0,
        allTimeRequests: parsed.allTimeRequests || 0,
        allTimeDownloads: parsed.allTimeDownloads || 0,
        daily: parsed.daily || {},
      };
    }
  }
} catch (e) {
  console.error('[Telemetry] Failed to load traffic stats:', e);
}

// Lazy persistence with debouncing
let saveTimeout: NodeJS.Timeout | null = null;
function scheduleSaveTraffic() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STATS_FILE, JSON.stringify(trafficLedger, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Telemetry] Failed to write traffic stats to disk:', err);
    }
  }, 10_000); // Debounce saves to every 10 seconds
}

// ─── CPU Calculation ────────────────────────────────────────────────────────

function getCpuTimes() {
  const cpus = os.cpus() || [];
  let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
  for (const cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }
  const total = user + nice + sys + idle + irq;
  return { idle, total };
}

let prevCpuTimes = getCpuTimes();

export function getCurrentCpuPercent(): number {
  const current = getCpuTimes();
  const idleDiff = current.idle - prevCpuTimes.idle;
  const totalDiff = current.total - prevCpuTimes.total;
  prevCpuTimes = current;
  if (totalDiff <= 0) return 0;
  const usage = 100 - (idleDiff / totalDiff) * 100;
  return Math.max(0, Math.min(100, Math.round(usage * 10) / 10));
}

// Initialize CPU measurement tick
setInterval(() => {
  getCurrentCpuPercent();
}, 2000).unref();

// ─── Public API ─────────────────────────────────────────────────────────────

export function setActiveTasksCount(count: number) {
  activeTasksCount = Math.max(0, count);
}

export function incrementActiveTasks() {
  activeTasksCount++;
}

export function decrementActiveTasks() {
  activeTasksCount = Math.max(0, activeTasksCount - 1);
}

export function logRequest(entry: Omit<RequestLogEntry, 'id' | 'timestamp'>) {
  const now = new Date();
  const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD

  const fullEntry: RequestLogEntry = {
    id,
    timestamp: now.toISOString(),
    ...entry,
  };

  // Add to in-memory Ring Buffer
  recentLogs.unshift(fullEntry);
  if (recentLogs.length > MAX_RING_BUFFER_SIZE) {
    recentLogs.pop();
  }

  // Update Aggregate Traffic Ledger
  const bytes = entry.bytesTransferred || 0;
  trafficLedger.allTimeBytes += bytes;
  trafficLedger.allTimeRequests += 1;
  if (entry.endpoint.includes('/stream') || entry.action === 'download') {
    trafficLedger.allTimeDownloads += 1;
  }

  if (!trafficLedger.daily[dateStr]) {
    trafficLedger.daily[dateStr] = {
      date: dateStr,
      totalRequests: 0,
      totalBytes: 0,
      uniqueIps: 0,
      platformBytes: { youtube: 0, tiktok: 0, instagram: 0, facebook: 0, other: 0 },
      downloadsCount: 0,
    };
  }

  const day = trafficLedger.daily[dateStr];
  day.totalRequests += 1;
  day.totalBytes += bytes;
  if (entry.endpoint.includes('/stream') || entry.action === 'download') {
    day.downloadsCount += 1;
  }

  const p = (entry.platform || 'other').toLowerCase() as keyof PlatformBandwidth;
  if (p in day.platformBytes) {
    day.platformBytes[p] += bytes;
  } else {
    day.platformBytes.other += bytes;
  }

  scheduleSaveTraffic();
}

export function getRecentLogs(limit = 200, filterIp?: string): RequestLogEntry[] {
  if (filterIp) {
    return recentLogs.filter((l) => l.ip === filterIp).slice(0, limit);
  }
  return recentLogs.slice(0, limit);
}

export function getTrafficSummary() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const today = trafficLedger.daily[todayStr] || {
    date: todayStr,
    totalRequests: 0,
    totalBytes: 0,
    uniqueIps: 0,
    platformBytes: { youtube: 0, tiktok: 0, instagram: 0, facebook: 0, other: 0 },
    downloadsCount: 0,
  };

  return {
    allTime: {
      totalBytes: trafficLedger.allTimeBytes,
      totalRequests: trafficLedger.allTimeRequests,
      totalDownloads: trafficLedger.allTimeDownloads,
    },
    today,
    dailyHistory: Object.values(trafficLedger.daily)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7), // Last 7 days
  };
}

export function getSystemMetrics(): SystemMetrics {
  const cpus = os.cpus() || [];
  const cpuPercent = getCurrentCpuPercent();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const ramPercent = Math.round((usedMem / totalMem) * 100);

  let diskTotal = 0;
  let diskFree = 0;
  let diskUsed = 0;
  let diskPercent = 0;

  try {
    if (typeof fs.statfsSync === 'function') {
      const stat = fs.statfsSync(process.cwd());
      diskTotal = stat.bsize * stat.blocks;
      diskFree = stat.bsize * stat.bavail;
      diskUsed = diskTotal - diskFree;
      diskPercent = diskTotal > 0 ? Math.round((diskUsed / diskTotal) * 100) : 0;
    }
  } catch {
    // In fallback environments where statfsSync is unavailable
  }

  return {
    cpuPercent,
    cpuCores: cpus.length,
    cpuModel: cpus[0]?.model || 'Unknown CPU',
    ramTotalBytes: totalMem,
    ramFreeBytes: freeMem,
    ramUsedBytes: usedMem,
    ramPercent,
    processMemoryRssBytes: process.memoryUsage().rss,
    diskTotalBytes: diskTotal,
    diskFreeBytes: diskFree,
    diskUsedBytes: diskUsed,
    diskPercent,
    systemUptimeSec: Math.round(os.uptime()),
    processUptimeSec: Math.round(process.uptime()),
    loadAverage: os.loadavg() || [0, 0, 0],
    activeRenderTasks: activeTasksCount,
  };
}

export function clearLogs() {
  recentLogs.length = 0;
}
