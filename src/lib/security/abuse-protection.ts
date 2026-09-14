import fs from 'fs';
import path from 'path';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface BannedIpRecord {
  ip: string;
  reason: string;
  bannedAt: string;
  expiresAt: number | null; // Unix ms timestamp or null (permanent)
  bannedBy: 'admin' | 'auto';
}

export interface SecurityConfig {
  maxRequestsPerMinute: number;
  maxDailyBandwidthBytesPerIp: number; // e.g. 5GB = 5 * 1024 * 1024 * 1024
  autoBanThresholdScore: number;       // default 75
  autoBanDurationHours: number;        // default 24
  blockKnownScraperBots: boolean;      // default true
}

export interface IpProfile {
  ip: string;
  firstSeen: number;
  lastSeen: number;
  requestsInWindow: number;
  dailyBytes: number;
  failedRequests: number;
  activeConcurrent: number;
  userAgents: string[];
  riskScore: number;
  fraudFlags: string[];
  status: 'normal' | 'suspicious' | 'abusive' | 'banned';
}

// ─── Constants & Paths ──────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), 'data');
const BANNED_IPS_FILE = path.join(DATA_DIR, 'banned-ips.json');
const CONFIG_FILE = path.join(DATA_DIR, 'security-config.json');

const DEFAULT_CONFIG: SecurityConfig = {
  maxRequestsPerMinute: 20,
  maxDailyBandwidthBytesPerIp: 5 * 1024 * 1024 * 1024, // 5 GB per day
  autoBanThresholdScore: 75,
  autoBanDurationHours: 24,
  blockKnownScraperBots: true,
};

// Known scraper / bot signatures
const KNOWN_BOT_PATTERNS = [
  /python-requests/i,
  /aiohttp/i,
  /scrapy/i,
  /curl\//i,
  /wget\//i,
  /go-http-client/i,
  /httpclient/i,
  /libwww-perl/i,
  /node-fetch/i,
  /axios\//i,
  /postman/i,
  /headlesschrome/i,
];

// ─── State ──────────────────────────────────────────────────────────────────

const ipStore = new Map<string, {
  firstSeen: number;
  lastSeen: number;
  windowStart: number;
  requestsInWindow: number;
  dailyWindowStart: number;
  dailyBytes: number;
  failedCount: number;
  activeConcurrent: number;
  userAgents: Set<string>;
}>();

let bannedIps: Record<string, BannedIpRecord> = {};
let securityConfig: SecurityConfig = { ...DEFAULT_CONFIG };

// Load persistent data
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(BANNED_IPS_FILE)) {
    const raw = fs.readFileSync(BANNED_IPS_FILE, 'utf-8');
    bannedIps = JSON.parse(raw) || {};
  }

  if (fs.existsSync(CONFIG_FILE)) {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    securityConfig = { ...DEFAULT_CONFIG, ...(JSON.parse(raw) || {}) };
  }
} catch (e) {
  console.error('[AbuseProtection] Failed to load data:', e);
}

function saveBannedIps() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BANNED_IPS_FILE, JSON.stringify(bannedIps, null, 2), 'utf-8');
  } catch (err) {
    console.error('[AbuseProtection] Failed to save banned IPs:', err);
  }
}

function saveSecurityConfig() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(securityConfig, null, 2), 'utf-8');
  } catch (err) {
    console.error('[AbuseProtection] Failed to save config:', err);
  }
}

// ─── Risk Calculation ───────────────────────────────────────────────────────

function calculateRisk(ip: string, userAgent = ''): { score: number; flags: string[] } {
  const profile = ipStore.get(ip);
  const flags: string[] = [];
  let score = 0;

  if (isBotUserAgent(userAgent)) {
    score += 45;
    flags.push('BOT_SCRAPER_USERAGENT');
  }

  if (!profile) return { score, flags };

  // 1. Frequency check (exceeding window)
  if (profile.requestsInWindow > securityConfig.maxRequestsPerMinute) {
    score += 35;
    flags.push(`RATE_FLOOD (${profile.requestsInWindow} req/min)`);
  }

  // 2. High Bandwidth Leeching
  if (profile.dailyBytes > securityConfig.maxDailyBandwidthBytesPerIp) {
    score += 40;
    const gb = (profile.dailyBytes / (1024 * 1024 * 1024)).toFixed(1);
    flags.push(`BANDWIDTH_HOG (${gb} GB/24h)`);
  }

  // 3. High Failure Rate (> 70% errors with at least 5 requests)
  if (profile.requestsInWindow >= 5 && profile.failedCount / profile.requestsInWindow > 0.7) {
    score += 25;
    flags.push('HIGH_FAILURE_PROBING');
  }

  // 4. Excessive Concurrent Tasks
  if (profile.activeConcurrent >= 3) {
    score += 30;
    flags.push(`CONCURRENCY_ABUSE (${profile.activeConcurrent} tasks)`);
  }

  return { score: Math.min(100, score), flags };
}

export function isBotUserAgent(userAgent: string): boolean {
  if (!userAgent || userAgent.trim().length === 0) return true;
  return KNOWN_BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function checkIpAccess(ip: string, userAgent = ''): { allowed: boolean; reason?: string; code?: string } {
  const now = Date.now();

  // 1. Check if IP is in ban list
  if (bannedIps[ip]) {
    const ban = bannedIps[ip];
    if (ban.expiresAt && ban.expiresAt < now) {
      // Ban expired
      delete bannedIps[ip];
      saveBannedIps();
    } else {
      return {
        allowed: false,
        reason: `Akses IP ini diblokir (${ban.reason}). Silakan hubungi admin jika ini kekeliruan.`,
        code: 'IP_BANNED',
      };
    }
  }

  // 2. Block known malicious scrapers if enabled
  if (securityConfig.blockKnownScraperBots && isBotUserAgent(userAgent)) {
    return {
      allowed: false,
      reason: 'Akses ditolak: User-agent bot / automated script terdeteksi.',
      code: 'BOT_BLOCKED',
    };
  }

  // 3. Check daily bandwidth limit
  const profile = ipStore.get(ip);
  if (profile) {
    // Reset daily window if 24 hours elapsed
    if (now - profile.dailyWindowStart > 24 * 60 * 60 * 1000) {
      profile.dailyWindowStart = now;
      profile.dailyBytes = 0;
    }

    if (profile.dailyBytes > securityConfig.maxDailyBandwidthBytesPerIp) {
      const gbLimit = (securityConfig.maxDailyBandwidthBytesPerIp / (1024 * 1024 * 1024)).toFixed(0);
      return {
        allowed: false,
        reason: `Batas kuota unduhan harian (${gbLimit} GB) untuk IP Anda telah tercapai. Silakan coba lagi besok.`,
        code: 'DAILY_QUOTA_EXCEEDED',
      };
    }
  }

  return { allowed: true };
}

export function recordIpActivity(
  ip: string,
  options: {
    bytes?: number;
    isError?: boolean;
    userAgent?: string;
    incrementConcurrent?: boolean;
    decrementConcurrent?: boolean;
  }
) {
  const now = Date.now();
  let record = ipStore.get(ip);

  if (!record) {
    record = {
      firstSeen: now,
      lastSeen: now,
      windowStart: now,
      requestsInWindow: 0,
      dailyWindowStart: now,
      dailyBytes: 0,
      failedCount: 0,
      activeConcurrent: 0,
      userAgents: new Set(),
    };
    ipStore.set(ip, record);
  }

  record.lastSeen = now;
  record.requestsInWindow += 1;

  // Window reset (every 60s)
  if (now - record.windowStart > 60_000) {
    record.windowStart = now;
    record.requestsInWindow = 1;
    record.failedCount = 0;
  }

  // Daily window reset (every 24h)
  if (now - record.dailyWindowStart > 24 * 60 * 60 * 1000) {
    record.dailyWindowStart = now;
    record.dailyBytes = 0;
  }

  if (options.bytes) {
    record.dailyBytes += options.bytes;
  }
  if (options.isError) {
    record.failedCount += 1;
  }
  if (options.userAgent) {
    record.userAgents.add(options.userAgent.slice(0, 150));
  }
  if (options.incrementConcurrent) {
    record.activeConcurrent += 1;
  }
  if (options.decrementConcurrent) {
    record.activeConcurrent = Math.max(0, record.activeConcurrent - 1);
  }

  // Auto-ban check if risk score exceeds threshold
  const risk = calculateRisk(ip, options.userAgent);
  if (risk.score >= securityConfig.autoBanThresholdScore && !bannedIps[ip]) {
    banIp(ip, `Terdeteksi aktivitas fraud otomatis: ${risk.flags.join(', ')}`, securityConfig.autoBanDurationHours, 'auto');
  }
}

export function banIp(ip: string, reason: string, durationHours: number | null = 24, bannedBy: 'admin' | 'auto' = 'admin') {
  const now = Date.now();
  const expiresAt = durationHours ? now + durationHours * 3600 * 1000 : null;

  bannedIps[ip] = {
    ip,
    reason: reason || 'Pelanggaran batas wajar / suspicious activity',
    bannedAt: new Date(now).toISOString(),
    expiresAt,
    bannedBy,
  };
  saveBannedIps();
}

export function unbanIp(ip: string) {
  if (bannedIps[ip]) {
    delete bannedIps[ip];
    saveBannedIps();
  }
}

export function getBannedIps(): BannedIpRecord[] {
  const now = Date.now();
  let changed = false;

  // Cleanup expired bans
  for (const [ip, ban] of Object.entries(bannedIps)) {
    if (ban.expiresAt && ban.expiresAt < now) {
      delete bannedIps[ip];
      changed = true;
    }
  }
  if (changed) saveBannedIps();

  return Object.values(bannedIps);
}

export function getFlaggedIps(): IpProfile[] {
  const profiles: IpProfile[] = [];

  for (const [ip, data] of ipStore.entries()) {
    const userAgent = Array.from(data.userAgents)[0] || '';
    const risk = calculateRisk(ip, userAgent);
    const isBanned = Boolean(bannedIps[ip]);

    let status: IpProfile['status'] = 'normal';
    if (isBanned) status = 'banned';
    else if (risk.score >= 60) status = 'abusive';
    else if (risk.score >= 30) status = 'suspicious';

    if (status !== 'normal' || isBanned || data.dailyBytes > 500 * 1024 * 1024) {
      profiles.push({
        ip,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen,
        requestsInWindow: data.requestsInWindow,
        dailyBytes: data.dailyBytes,
        failedRequests: data.failedCount,
        activeConcurrent: data.activeConcurrent,
        userAgents: Array.from(data.userAgents),
        riskScore: risk.score,
        fraudFlags: risk.flags,
        status,
      });
    }
  }

  return profiles.sort((a, b) => b.riskScore - a.riskScore);
}

export function getSecurityConfig(): SecurityConfig {
  return { ...securityConfig };
}

export function updateSecurityConfig(partial: Partial<SecurityConfig>) {
  securityConfig = { ...securityConfig, ...partial };
  saveSecurityConfig();
  return securityConfig;
}
