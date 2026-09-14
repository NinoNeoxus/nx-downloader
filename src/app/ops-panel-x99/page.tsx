'use client';

import { useState, useEffect, useRef, ChangeEvent, DragEvent, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Shield,
  Key,
  Database,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  X,
  RefreshCw,
  Cpu,
  HardDrive,
  Activity,
  AlertTriangle,
  Users,
  Clock,
  ExternalLink,
  Ban,
  Check,
  Search,
  Filter,
  Trash2,
  Layers,
  Settings,
  Globe,
  Radio,
  Share2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type TabKey = 'overview' | 'traffic' | 'antifraud' | 'cookies';
type PlatformKey = 'youtube' | 'instagram' | 'tiktok';

interface SystemMetrics {
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

interface TrafficSummary {
  allTime: { totalBytes: number; totalRequests: number; totalDownloads: number };
  today: {
    date: string;
    totalRequests: number;
    totalBytes: number;
    uniqueIps: number;
    platformBytes: { youtube: number; tiktok: number; instagram: number; facebook: number; other: number };
    downloadsCount: number;
  };
  dailyHistory: Array<{
    date: string;
    totalRequests: number;
    totalBytes: number;
    downloadsCount: number;
  }>;
}

interface RequestLog {
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

interface FlaggedIp {
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

interface BannedIp {
  ip: string;
  reason: string;
  bannedAt: string;
  expiresAt: number | null;
  bannedBy: 'admin' | 'auto';
}

interface SecurityConfig {
  maxRequestsPerMinute: number;
  maxDailyBandwidthBytesPerIp: number;
  autoBanThresholdScore: number;
  autoBanDurationHours: number;
  blockKnownScraperBots: boolean;
}

interface PendingCookie {
  id: string;
  platform: string;
  submittedAt: string;
  ip: string;
  sizeKb: number;
  note: string;
  content: string;
}

function formatBytes(bytes?: number): string {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}h ${h}j ${m}m`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}

export default function AdminOpsPanel() {
  const [pin, setPin] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Data states
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [traffic, setTraffic] = useState<TrafficSummary | null>(null);
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [flaggedIps, setFlaggedIps] = useState<FlaggedIp[]>([]);
  const [bannedIps, setBannedIps] = useState<BannedIp[]>([]);
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig | null>(null);
  const [cookieStatuses, setCookieStatuses] = useState<Record<string, { exists: boolean; sizeKb?: number; updatedAt?: string }>>({});
  const [pendingCookies, setPendingCookies] = useState<PendingCookie[]>([]);

  // Logs filters
  const [logSearch, setLogSearch] = useState('');
  const [logPlatformFilter, setLogPlatformFilter] = useState('all');
  const [logStatusFilter, setLogStatusFilter] = useState('all');

  // Cookie testing state
  const [testingCookie, setTestingCookie] = useState<string | null>(null);
  const [cookieTestResult, setCookieTestResult] = useState<{ platform: string; valid: boolean; message: string } | null>(null);

  // Manual Ban Modal
  const [manualBanIp, setManualBanIp] = useState('');
  const [manualBanReason, setManualBanReason] = useState('');
  const [manualBanHours, setManualBanHours] = useState('24');
  const [showBanModal, setShowBanModal] = useState(false);

  // Upload cookie states
  const [uploadPlatform, setUploadPlatform] = useState<PlatformKey>('youtube');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to get active admin PIN
  const getAdminPin = () => sessionStorage.getItem('ops_admin_pin') || pin;

  // Check saved session
  useEffect(() => {
    const savedPin = sessionStorage.getItem('ops_admin_pin');
    if (savedPin) {
      setPin(savedPin);
      setIsAuthenticated(true);
    }
  }, []);

  // ─── Fetch All Stats ────────────────────────────────────────────────────────
  const fetchAllData = useCallback(async () => {
    if (!isAuthenticated) return;
    const currentPin = sessionStorage.getItem('ops_admin_pin') || pin;
    setIsRefreshing(true);
    try {
      const res = await fetch(`/api/admin/stats?pin=${encodeURIComponent(currentPin)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setMetrics(json.data.systemMetrics);
          setTraffic(json.data.traffic);
          setLogs(json.data.recentLogs || []);
          setFlaggedIps(json.data.flaggedIps || []);
          setBannedIps(json.data.bannedIps || []);
          setSecurityConfig(json.data.securityConfig);
          setCookieStatuses(json.data.cookieStatuses || {});
          setPendingCookies(json.data.pendingCookies || []);
        }
      }
    } catch {
      // Ignore background errors
    } finally {
      setIsRefreshing(false);
    }
  }, [isAuthenticated, pin]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchAllData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchAllData, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated, autoRefresh, fetchAllData]);

  // ─── Authentication ─────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const enteredPin = pin.trim();
    if (!enteredPin) return;
    try {
      const res = await fetch(`/api/admin/stats?pin=${encodeURIComponent(enteredPin)}`);
      if (res.ok) {
        sessionStorage.setItem('ops_admin_pin', enteredPin);
        setIsAuthenticated(true);
        toast.success('Access Granted', { description: 'Selamat datang di Ops & Monitoring Panel' });
      } else {
        toast.error('Access Denied', { description: 'PIN salah.' });
      }
    } catch {
      toast.error('Connection Error', { description: 'Gagal terhubung ke server.' });
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('ops_admin_pin');
    setIsAuthenticated(false);
    setPin('');
  };

  // ─── Admin Actions ──────────────────────────────────────────────────────────
  const handleBanIp = async (ip: string, reason = 'Banned by admin', hours = 24) => {
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: getAdminPin(), action: 'ban_ip', ip, reason, durationHours: hours }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`IP ${ip} Berhasil Diblokir!`);
        setShowBanModal(false);
        fetchAllData();
      } else {
        toast.error('Gagal memblokir IP', { description: data.error });
      }
    } catch {
      toast.error('Koneksi gagal');
    }
  };

  const handleUnbanIp = async (ip: string) => {
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: getAdminPin(), action: 'unban_ip', ip }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`IP ${ip} Berhasil Dibuka Blokirnya!`);
        fetchAllData();
      }
    } catch {
      toast.error('Koneksi gagal');
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Yakin ingin membersihkan seluruh riwayat log request?')) return;
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: getAdminPin(), action: 'clear_logs' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Log dibersihkan.');
        fetchAllData();
      }
    } catch {}
  };

  const handleTestCookie = async (platform: string) => {
    setTestingCookie(platform);
    setCookieTestResult(null);
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: getAdminPin(), action: 'test_cookie', platform }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setCookieTestResult({ platform, valid: data.result.valid, message: data.result.message });
        if (data.result.valid) {
          toast.success(`Cookie ${platform.toUpperCase()} Sehat!`, { description: data.result.message });
        } else {
          toast.error(`Peringatan Cookie ${platform.toUpperCase()}`, { description: data.result.message });
        }
      }
    } catch {
      toast.error('Gagal menguji cookie');
    } finally {
      setTestingCookie(null);
    }
  };

  const handleApprovePendingCookie = async (id: string) => {
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: getAdminPin(), action: 'approve_cookie', id }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Cookie Pengguna Berhasil Diaktifkan!');
        fetchAllData();
      } else {
        toast.error('Gagal mengaktifkan cookie', { description: data.error });
      }
    } catch {}
  };

  const handleRejectPendingCookie = async (id: string) => {
    try {
      await fetch('/api/admin/stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: getAdminPin(), action: 'reject_cookie', id }),
      });
      toast.info('Sumbangan cookie dihapus.');
      fetchAllData();
    } catch {}
  };

  const handleUploadCookie = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;
    setIsUploading(true);
    const fd = new FormData();
    fd.append('pin', getAdminPin());
    fd.append('platform', uploadPlatform);
    fd.append('file', selectedFile);

    try {
      const res = await fetch('/api/admin/cookies', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Cookie ${uploadPlatform.toUpperCase()} Berhasil Diperbarui!`);
        setSelectedFile(null);
        fetchAllData();
      } else {
        toast.error('Upload Gagal', { description: data.error });
      }
    } catch {
      toast.error('Koneksi Gagal');
    } finally {
      setIsUploading(false);
    }
  };

  // ─── Filtered Logs ──────────────────────────────────────────────────────────
  const filteredLogs = logs.filter((log) => {
    if (logSearch) {
      const q = logSearch.toLowerCase();
      const matchIp = log.ip.toLowerCase().includes(q);
      const matchTitle = (log.title || '').toLowerCase().includes(q);
      const matchUrl = (log.targetUrl || '').toLowerCase().includes(q);
      if (!matchIp && !matchTitle && !matchUrl) return false;
    }
    if (logPlatformFilter !== 'all' && log.platform !== logPlatformFilter) return false;
    if (logStatusFilter !== 'all') {
      if (logStatusFilter === '200' && log.statusCode !== 200) return false;
      if (logStatusFilter === '4xx' && (log.statusCode < 400 || log.statusCode >= 500)) return false;
      if (logStatusFilter === '5xx' && log.statusCode < 500) return false;
    }
    return true;
  });

  // ─── LOGIN VIEW ─────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm p-6 rounded-2xl border border-zinc-800 bg-zinc-900/80 backdrop-blur-xl shadow-2xl space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Ops Control Center</h1>
              <p className="text-xs text-zinc-400">Autentikasi PIN Administrator</p>
            </div>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-zinc-400 font-medium">Security PIN</label>
              <div className="relative">
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800/80 border border-zinc-700/60 text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500 text-center tracking-widest text-lg font-mono"
                />
                <Key className="w-4 h-4 text-zinc-500 absolute left-3 top-3.5" />
              </div>
            </div>
            <button
              type="submit"
              className="w-full py-2.5 rounded-xl font-semibold text-xs bg-brand-600 hover:bg-brand-500 text-white transition-colors shadow-lg shadow-brand-600/20"
            >
              Buka Panel Monitoring
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── DASHBOARD VIEW ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pb-16">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-brand-500/20">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-white tracking-tight">Ops & Security Monitor</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 font-mono">Server Operations &amp; Anti-Abuse Telemetry</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Auto-refresh toggle */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs flex items-center gap-1.5 transition-all ${
                autoRefresh
                  ? 'bg-brand-950/40 border-brand-500/30 text-brand-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500'
              }`}
              title="Toggle auto-refresh every 3 seconds"
            >
              <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'text-brand-400 animate-pulse' : ''}`} />
              <span className="hidden sm:inline">Auto 3s</span>
            </button>

            {/* Manual refresh */}
            <button
              onClick={fetchAllData}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              title="Refresh Data Now"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-brand-400' : ''}`} />
            </button>

            {/* Public cookie contribution link */}
            <a
              href="/submit-cookie"
              target="_blank"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-300 transition-colors"
            >
              <Share2 className="w-3.5 h-3.5 text-brand-400" /> Portal Sumbang Cookie
            </a>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-950/20 hover:bg-red-950/40 text-xs font-semibold text-red-400 transition-colors"
            >
              Keluar
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-8 pt-6 space-y-6">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 overflow-x-auto">
          {[
            { key: 'overview', label: 'Overview & Sistem', icon: Activity },
            { key: 'traffic', label: `Live IP Logs (${logs.length})`, icon: Globe },
            { key: 'antifraud', label: `Anti-Fraud & Limit (${flaggedIps.length})`, icon: Shield },
            { key: 'cookies', label: `Cookies Platform (${pendingCookies.length > 0 ? `+${pendingCookies.length}` : '3'})`, icon: Database },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabKey)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                  isActive
                    ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ─── TAB 1: OVERVIEW & SYSTEM HEALTH ──────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {/* CPU Metric */}
              <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Cpu className="w-4 h-4 text-cyan-400" /> CPU Usage
                  </span>
                  <span className="font-mono text-[11px]">{metrics?.cpuCores ?? 1} Cores</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-white">{metrics?.cpuPercent ?? 0}%</span>
                  <span className="text-[11px] text-zinc-500 font-mono truncate max-w-[120px]">{metrics?.cpuModel || 'CPU'}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      (metrics?.cpuPercent ?? 0) > 80 ? 'bg-red-500' : (metrics?.cpuPercent ?? 0) > 50 ? 'bg-amber-500' : 'bg-cyan-400'
                    }`}
                    style={{ width: `${Math.min(100, metrics?.cpuPercent ?? 0)}%` }}
                  />
                </div>
              </div>

              {/* RAM Metric */}
              <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Layers className="w-4 h-4 text-brand-400" /> RAM Server
                  </span>
                  <span className="font-mono text-[11px]">{metrics?.ramPercent ?? 0}%</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-white">
                    {formatBytes(metrics?.ramUsedBytes)}
                  </span>
                  <span className="text-[11px] text-zinc-500 font-mono">/ {formatBytes(metrics?.ramTotalBytes)}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      (metrics?.ramPercent ?? 0) > 85 ? 'bg-red-500' : 'bg-brand-500'
                    }`}
                    style={{ width: `${Math.min(100, metrics?.ramPercent ?? 0)}%` }}
                  />
                </div>
              </div>

              {/* Disk NVMe Metric */}
              <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <HardDrive className="w-4 h-4 text-emerald-400" /> Disk NVMe
                  </span>
                  <span className="font-mono text-[11px]">{metrics?.diskPercent ?? 0}%</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-white">
                    {formatBytes(metrics?.diskUsedBytes)}
                  </span>
                  <span className="text-[11px] text-zinc-500 font-mono">/ {formatBytes(metrics?.diskTotalBytes)}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      (metrics?.diskPercent ?? 0) > 90 ? 'bg-red-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.min(100, metrics?.diskPercent ?? 0)}%` }}
                  />
                </div>
              </div>

              {/* Active Tasks & Uptime */}
              <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Clock className="w-4 h-4 text-amber-400" /> Uptime & Tasks
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300">
                    {metrics?.activeRenderTasks ?? 0} aktif
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xl font-bold font-mono text-white">
                    {formatUptime(metrics?.systemUptimeSec ?? 0)}
                  </span>
                  <span className="text-[11px] text-zinc-500 font-mono">
                    Load: {(metrics?.loadAverage?.[0] ?? 0).toFixed(2)}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 truncate">
                  Node RSS: {formatBytes(metrics?.processMemoryRssBytes)}
                </p>
              </div>
            </div>

            {/* Bandwidth & Data Usage Ledger */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Card 1: Bandwidth Summary */}
              <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-4 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <Database className="w-4 h-4 text-brand-400" /> Data Usage & Bandwidth Egress
                    </h2>
                    <p className="text-xs text-zinc-400">Akumulasi kuota keluar server untuk unduhan pengguna</p>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-brand-500/10 text-brand-400 border border-brand-500/20">
                    Hari Ini: {formatBytes(traffic?.today?.totalBytes)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800">
                    <span className="text-[11px] text-zinc-500">Total Bandwidth Sepanjang Masa</span>
                    <p className="text-lg font-bold font-mono text-white">{formatBytes(traffic?.allTime?.totalBytes)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800">
                    <span className="text-[11px] text-zinc-500">Total Unduhan Berhasil</span>
                    <p className="text-lg font-bold font-mono text-emerald-400">{traffic?.allTime?.totalDownloads ?? 0}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800">
                    <span className="text-[11px] text-zinc-500">Total Request Dilayani</span>
                    <p className="text-lg font-bold font-mono text-cyan-400">{traffic?.allTime?.totalRequests ?? 0}</p>
                  </div>
                </div>

                {/* Platform Bandwidth Breakdown */}
                <div className="space-y-2 pt-2">
                  <h3 className="text-xs font-semibold text-zinc-300">Penggunaan Kuota per Platform Hari Ini</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { name: 'YouTube', bytes: traffic?.today?.platformBytes?.youtube || 0, color: 'text-red-400 border-red-500/20 bg-red-500/5' },
                      { name: 'TikTok', bytes: traffic?.today?.platformBytes?.tiktok || 0, color: 'text-cyan-400 border-cyan-500/20 bg-cyan-500/5' },
                      { name: 'Instagram', bytes: traffic?.today?.platformBytes?.instagram || 0, color: 'text-fuchsia-400 border-fuchsia-500/20 bg-fuchsia-500/5' },
                      { name: 'Facebook', bytes: traffic?.today?.platformBytes?.facebook || 0, color: 'text-blue-400 border-blue-500/20 bg-blue-500/5' },
                    ].map((p) => (
                      <div key={p.name} className={`p-2.5 rounded-xl border ${p.color}`}>
                        <span className="text-[10px] font-semibold uppercase">{p.name}</span>
                        <p className="text-sm font-bold font-mono">{formatBytes(p.bytes)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Card 2: Fraud & Security Snapshot */}
              <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <Shield className="w-4 h-4 text-emerald-400" /> Proteksi Server
                    </h2>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Aktif
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Sistem mendeteksi scraper, spammer, dan penyedot bandwidth berlebihan secara otomatis.
                  </p>

                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-800/40 text-xs">
                      <span className="text-zinc-400">IP Terblokir (Banned)</span>
                      <span className="font-mono font-bold text-red-400">{bannedIps.length} IP</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-800/40 text-xs">
                      <span className="text-zinc-400">IP Mencurigakan (High Risk)</span>
                      <span className="font-mono font-bold text-amber-400">{flaggedIps.length} IP</span>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-800/40 text-xs">
                      <span className="text-zinc-400">Batas Kuota per IP</span>
                      <span className="font-mono font-bold text-zinc-300">
                        {formatBytes(securityConfig?.maxDailyBandwidthBytesPerIp)}/hari
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setActiveTab('antifraud')}
                  className="w-full py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white transition-colors"
                >
                  Kelola Aturan & Blokir IP →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 2: LIVE REQUEST & IP LOGS ────────────────────────────────── */}
        {activeTab === 'traffic' && (
          <div className="space-y-4">
            {/* Filter Bar */}
            <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                <div className="relative w-full max-w-sm">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Cari IP, Judul Video, atau URL…"
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-zinc-800/80 border border-zinc-700/60 text-white placeholder-zinc-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Platform Filter */}
                <select
                  value={logPlatformFilter}
                  onChange={(e) => setLogPlatformFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none"
                >
                  <option value="all">Semua Platform</option>
                  <option value="youtube">YouTube</option>
                  <option value="tiktok">TikTok</option>
                  <option value="instagram">Instagram</option>
                  <option value="facebook">Facebook</option>
                </select>

                {/* Status Filter */}
                <select
                  value={logStatusFilter}
                  onChange={(e) => setLogStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none"
                >
                  <option value="all">Semua Status</option>
                  <option value="200">200 OK</option>
                  <option value="4xx">4xx Client Error</option>
                  <option value="5xx">5xx Server Error</option>
                </select>

                {/* Clear Logs */}
                <button
                  onClick={handleClearLogs}
                  className="px-2.5 py-1.5 text-xs rounded-xl border border-red-500/20 bg-red-950/20 hover:bg-red-950/40 text-red-400 flex items-center gap-1 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Bersihkan
                </button>
              </div>
            </div>

            {/* Logs Table */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden shadow-xl">
              <div className="overflow-x-auto max-h-[600px]">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-[11px] uppercase tracking-wider font-semibold z-10">
                    <tr>
                      <th className="py-3 px-4">Waktu</th>
                      <th className="py-3 px-4">IP & Negara</th>
                      <th className="py-3 px-4">Platform</th>
                      <th className="py-3 px-4">Aksi / Endpoint</th>
                      <th className="py-3 px-4">Target / Title</th>
                      <th className="py-3 px-4">Data Keluar</th>
                      <th className="py-3 px-4">Durasi</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Tindakan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-zinc-500">
                          Belum ada catatan log aktivitas yang cocok dengan filter.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.map((log) => {
                        const isBanned = bannedIps.some((b) => b.ip === log.ip);
                        return (
                          <tr key={log.id} className="hover:bg-zinc-800/30 transition-colors">
                            <td className="py-2.5 px-4 text-zinc-400 whitespace-nowrap text-[11px]">
                              {new Date(log.timestamp).toLocaleTimeString('id-ID')}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-white">{log.ip}</span>
                                {log.country && (
                                  <span className="px-1 py-0.2 rounded text-[10px] bg-zinc-800 text-zinc-400 font-sans">
                                    {log.country}
                                  </span>
                                )}
                                {log.isBot && (
                                  <span className="px-1 py-0.2 rounded text-[9px] bg-red-950 text-red-400 border border-red-500/20 font-sans">
                                    BOT
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-4 capitalize font-sans">
                              {log.platform ? (
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                    log.platform === 'youtube'
                                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                      : log.platform === 'tiktok'
                                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                      : log.platform === 'instagram'
                                      ? 'bg-fuchsia-500/10 text-fuchsia-400 border border-fuchsia-500/20'
                                      : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                  }`}
                                >
                                  {log.platform}
                                </span>
                              ) : (
                                <span className="text-zinc-500">-</span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-zinc-300 text-[11px]">
                              {log.action ? `${log.endpoint}:${log.action}` : log.endpoint}
                            </td>
                            <td className="py-2.5 px-4 max-w-xs truncate text-zinc-300 font-sans text-xs" title={log.title || log.targetUrl}>
                              {log.title || log.targetUrl || '-'}
                            </td>
                            <td className="py-2.5 px-4 text-zinc-200">
                              {log.bytesTransferred > 0 ? formatBytes(log.bytesTransferred) : '-'}
                            </td>
                            <td className="py-2.5 px-4 text-zinc-400">
                              {log.durationMs > 0 ? `${log.durationMs}ms` : '-'}
                            </td>
                            <td className="py-2.5 px-4 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  log.statusCode === 200
                                    ? 'bg-emerald-500/10 text-emerald-400'
                                    : log.statusCode === 429
                                    ? 'bg-amber-500/10 text-amber-400'
                                    : 'bg-red-500/10 text-red-400'
                                }`}
                              >
                                {log.statusCode}
                              </span>
                            </td>
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              {isBanned ? (
                                <span className="text-[10px] text-red-400 font-sans font-bold">Banned</span>
                              ) : (
                                <button
                                  onClick={() => {
                                    setManualBanIp(log.ip);
                                    setManualBanReason(`Banned from logs (${log.platform || 'request'})`);
                                    setShowBanModal(true);
                                  }}
                                  className="px-2 py-1 rounded text-[10px] bg-red-950/40 hover:bg-red-900/60 border border-red-500/30 text-red-300 font-sans transition-colors"
                                >
                                  Ban IP
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 3: ANTI-FRAUD & IP LIMITS ─────────────────────────────────── */}
        {activeTab === 'antifraud' && (
          <div className="space-y-6">
            {/* Header / Config Bar */}
            <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <Shield className="w-5 h-5 text-brand-400" /> Pengaturan Batas Server & Anti-Boncos
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Atur kuota bandwidth maksimal per IP untuk mencegah user rakus / scraper menghabiskan resource server.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setManualBanIp('');
                    setManualBanReason('');
                    setShowBanModal(true);
                  }}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white flex items-center gap-1.5 shadow-md shadow-red-600/20"
                >
                  <Ban className="w-4 h-4" /> Blokir IP Manual
                </button>
              </div>

              {/* Quick Config Badges */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="p-3.5 rounded-xl bg-zinc-800/40 border border-zinc-800 space-y-1">
                  <span className="text-[11px] text-zinc-400">Batas Kuota Bandwidth Harian</span>
                  <p className="text-base font-bold font-mono text-white">
                    {formatBytes(securityConfig?.maxDailyBandwidthBytesPerIp)} / IP / Hari
                  </p>
                  <span className="text-[10px] text-zinc-500">Otomatis batasi unduhan jika terlampaui</span>
                </div>
                <div className="p-3.5 rounded-xl bg-zinc-800/40 border border-zinc-800 space-y-1">
                  <span className="text-[11px] text-zinc-400">Batas Kecepatan Request</span>
                  <p className="text-base font-bold font-mono text-white">
                    {securityConfig?.maxRequestsPerMinute ?? 20} req / menit
                  </p>
                  <span className="text-[10px] text-zinc-500">Mencegah serangan DDoS / flood scraper</span>
                </div>
                <div className="p-3.5 rounded-xl bg-zinc-800/40 border border-zinc-800 space-y-1">
                  <span className="text-[11px] text-zinc-400">Blokir Bot Otomatis</span>
                  <p className="text-base font-bold font-mono text-emerald-400">
                    {securityConfig?.blockKnownScraperBots ? 'AKTIF (Aktifkan Proteksi)' : 'NONAKTIF'}
                  </p>
                  <span className="text-[10px] text-zinc-500">Memblokir curl, python, wget scraper</span>
                </div>
              </div>
            </div>

            {/* Flagged Suspicious IPs Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" /> IP Terdeteksi Berisiko / Suspicious ({flaggedIps.length})
                </h3>
                <span className="text-xs text-zinc-500">Diperbarui otomatis berdasarkan perilaku request</span>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-[11px] uppercase font-semibold">
                    <tr>
                      <th className="py-3 px-4">Alamat IP</th>
                      <th className="py-3 px-4">Tingkat Risiko</th>
                      <th className="py-3 px-4">Indikasi Pelanggaran</th>
                      <th className="py-3 px-4">Data Terpakai (24h)</th>
                      <th className="py-3 px-4">Terakhir Aktif</th>
                      <th className="py-3 px-4 text-right">Tindakan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {flaggedIps.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-zinc-500 font-sans">
                          Tidak ada IP yang terdeteksi mencurigakan saat ini. Server berjalan aman!
                        </td>
                      </tr>
                    ) : (
                      flaggedIps.map((p) => (
                        <tr key={p.ip} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-3 px-4 font-bold text-white">{p.ip}</td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold font-sans ${
                                p.status === 'banned'
                                  ? 'bg-red-950 text-red-400 border border-red-500/30'
                                  : p.status === 'abusive'
                                  ? 'bg-red-950/80 text-red-400 border border-red-500/20'
                                  : 'bg-amber-950/60 text-amber-400 border border-amber-500/20'
                              }`}
                            >
                              Skor {p.riskScore} · {p.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-sans text-xs text-zinc-300">
                            {p.fraudFlags.join(', ') || 'High activity'}
                          </td>
                          <td className="py-3 px-4 text-zinc-200 font-bold">{formatBytes(p.dailyBytes)}</td>
                          <td className="py-3 px-4 text-zinc-400 whitespace-nowrap text-[11px]">
                            {new Date(p.lastSeen).toLocaleTimeString('id-ID')}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {p.status === 'banned' ? (
                              <button
                                onClick={() => handleUnbanIp(p.ip)}
                                className="px-2.5 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-sans transition-colors"
                              >
                                Buka Blokir
                              </button>
                            ) : (
                              <button
                                onClick={() => {
                                  setManualBanIp(p.ip);
                                  setManualBanReason(`Suspicious (${p.fraudFlags.join(', ')})`);
                                  setShowBanModal(true);
                                }}
                                className="px-2.5 py-1 rounded text-xs bg-red-950 hover:bg-red-900 text-red-300 border border-red-500/30 font-sans transition-colors"
                              >
                                Blokir IP Ini
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Currently Banned IPs Table */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Ban className="w-4 h-4 text-red-400" /> Daftar IP Terblokir ({bannedIps.length})
              </h3>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-900 border-b border-zinc-800 text-zinc-400 text-[11px] uppercase font-semibold">
                    <tr>
                      <th className="py-3 px-4">Alamat IP</th>
                      <th className="py-3 px-4">Alasan Pemblokiran</th>
                      <th className="py-3 px-4">Waktu Blokir</th>
                      <th className="py-3 px-4">Masa Berlaku</th>
                      <th className="py-3 px-4">Oleh</th>
                      <th className="py-3 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {bannedIps.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-zinc-500 font-sans">
                          Tidak ada IP yang sedang diblokir saat ini.
                        </td>
                      </tr>
                    ) : (
                      bannedIps.map((b) => (
                        <tr key={b.ip} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-3 px-4 font-bold text-white">{b.ip}</td>
                          <td className="py-3 px-4 font-sans text-xs text-zinc-300">{b.reason}</td>
                          <td className="py-3 px-4 text-zinc-400 text-[11px]">
                            {new Date(b.bannedAt).toLocaleString('id-ID')}
                          </td>
                          <td className="py-3 px-4 text-zinc-400 text-[11px]">
                            {b.expiresAt ? new Date(b.expiresAt).toLocaleString('id-ID') : 'Permanen'}
                          </td>
                          <td className="py-3 px-4 capitalize text-zinc-300">{b.bannedBy}</td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => handleUnbanIp(b.ip)}
                              className="px-2.5 py-1 rounded text-xs bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 font-sans transition-colors"
                            >
                              Buka Blokir
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 4: COOKIES & PLATFORM HEALTH ──────────────────────────────── */}
        {activeTab === 'cookies' && (
          <div className="space-y-6">
            {/* Shareable Cookie Contribution Box */}
            <div className="p-5 rounded-2xl border border-brand-500/30 bg-brand-950/20 backdrop-blur-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-brand-400" /> Minta Bantuan Cookie ke Pengguna
                </h3>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Jika YouTube / Instagram memblokir server karena bot-check, Anda dapat membagikan link portal berikut kepada pengguna tepercaya untuk menyumbangkan cookie:
                </p>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  readOnly
                  value={typeof window !== 'undefined' ? `${window.location.origin}/submit-cookie` : '/submit-cookie'}
                  className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-700 text-xs font-mono text-zinc-300 flex-1 sm:w-64"
                />
                <button
                  onClick={() => {
                    const portalUrl = typeof window !== 'undefined' ? `${window.location.origin}/submit-cookie` : '/submit-cookie';
                    navigator.clipboard.writeText(portalUrl);
                    toast.success('Link disalin ke clipboard!');
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white whitespace-nowrap"
                >
                  Salin Link
                </button>
              </div>
            </div>

            {/* Platform Cookie Health Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { key: 'youtube', name: 'YouTube', color: 'border-red-500/30 bg-red-950/10 text-red-400' },
                { key: 'instagram', name: 'Instagram', color: 'border-fuchsia-500/30 bg-fuchsia-950/10 text-fuchsia-400' },
                { key: 'tiktok', name: 'TikTok', color: 'border-cyan-500/30 bg-cyan-950/10 text-cyan-400' },
              ].map((p) => {
                const status = cookieStatuses[p.key];
                const isTesting = testingCookie === p.key;

                return (
                  <div key={p.key} className={`p-5 rounded-2xl border ${p.color} space-y-3`}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-white">{p.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          status?.exists ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {status?.exists ? 'TERPASANG' : 'BELUM ADA'}
                      </span>
                    </div>

                    <div className="text-xs text-zinc-400 space-y-1 font-mono">
                      <p>Ukuran: {status?.sizeKb ? `${status.sizeKb} KB` : '-'}</p>
                      <p className="truncate">
                        Update: {status?.updatedAt ? new Date(status.updatedAt).toLocaleString('id-ID') : '-'}
                      </p>
                    </div>

                    <button
                      onClick={() => handleTestCookie(p.key)}
                      disabled={isTesting || !status?.exists}
                      className="w-full py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-white flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Menguji Cookie…
                        </>
                      ) : (
                        'Uji Validitas Cookie (1-Click)'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Review Pending User Cookie Submissions */}
            {pendingCookies.length > 0 && (
              <div className="p-6 rounded-2xl border border-amber-500/30 bg-amber-950/10 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                    <Database className="w-4 h-4 text-amber-400" /> Antrean Sumbangan Cookie Pengguna ({pendingCookies.length})
                  </h3>
                  <span className="text-xs text-zinc-400">Siap diaktifkan ke server dengan 1 klik</span>
                </div>

                <div className="divide-y divide-zinc-800/80">
                  {pendingCookies.map((item) => (
                    <div key={item.id} className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-zinc-800 text-white">
                            {item.platform}
                          </span>
                          <span className="text-xs text-zinc-400 font-mono">
                            {item.sizeKb} KB · Dari IP {item.ip}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {new Date(item.submittedAt).toLocaleString('id-ID')}
                          </span>
                        </div>
                        {item.note && <p className="text-xs text-zinc-300 italic font-sans">"{item.note}"</p>}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleApprovePendingCookie(item.id)}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" /> Pasang Sekarang
                        </button>
                        <button
                          onClick={() => handleRejectPendingCookie(item.id)}
                          className="px-3 py-1.5 rounded-xl text-xs bg-zinc-800 hover:bg-zinc-700 text-red-400 transition-colors"
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Direct Admin File Uploader */}
            <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-brand-400" /> Upload File Cookie Langsung (.txt)
              </h3>

              <form onSubmit={handleUploadCookie} className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {(['youtube', 'instagram', 'tiktok'] as PlatformKey[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setUploadPlatform(p)}
                      className={`py-2 px-3 rounded-xl border text-xs font-semibold capitalize transition-all ${
                        uploadPlatform === p
                          ? 'bg-brand-600/20 border-brand-500 text-brand-300'
                          : 'bg-zinc-800/40 border-zinc-700 text-zinc-400'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-zinc-700/80 hover:border-zinc-500 rounded-2xl p-6 text-center cursor-pointer bg-zinc-900/40 transition-colors"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt"
                    className="hidden"
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const f = e.target.files?.[0];
                      if (f) setSelectedFile(f);
                    }}
                  />
                  {selectedFile ? (
                    <div className="space-y-1">
                      <FileText className="w-8 h-8 text-emerald-400 mx-auto" />
                      <p className="text-xs font-bold text-white">{selectedFile.name}</p>
                      <p className="text-[11px] text-zinc-500 font-mono">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Upload className="w-8 h-8 text-zinc-500 mx-auto" />
                      <p className="text-xs text-zinc-300">Pilih atau Drag file cookie .txt Netscape</p>
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!selectedFile || isUploading}
                  className="w-full py-2.5 rounded-xl text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 transition-colors"
                >
                  {isUploading ? 'Menyimpan ke Server…' : `Simpan Cookie ${uploadPlatform.toUpperCase()}`}
                </button>
              </form>
            </div>
          </div>
        )}
      </main>

      {/* ─── MODAL: MANUAL BAN IP ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showBanModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md p-6 rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Ban className="w-5 h-5 text-red-400" /> Blokir Alamat IP
                </h3>
                <button
                  onClick={() => setShowBanModal(false)}
                  className="p-1 rounded-lg hover:bg-zinc-800 text-zinc-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-zinc-400 font-medium">Alamat IP</label>
                  <input
                    type="text"
                    value={manualBanIp}
                    onChange={(e) => setManualBanIp(e.target.value)}
                    placeholder="Contoh: 180.252.12.34"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-white font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-zinc-400 font-medium">Alasan Pemblokiran</label>
                  <input
                    type="text"
                    value={manualBanReason}
                    onChange={(e) => setManualBanReason(e.target.value)}
                    placeholder="Contoh: Terdeteksi scraping video otomatis berulang"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-zinc-400 font-medium">Durasi Blokir</label>
                  <select
                    value={manualBanHours}
                    onChange={(e) => setManualBanHours(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-white"
                  >
                    <option value="1">1 Jam (Peringatan)</option>
                    <option value="6">6 Jam</option>
                    <option value="24">24 Jam (1 Hari)</option>
                    <option value="168">7 Hari (1 Minggu)</option>
                    <option value="0">Permanen</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBanModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => handleBanIp(manualBanIp, manualBanReason, Number(manualBanHours))}
                  disabled={!manualBanIp.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
                >
                  Terapkan Blokir
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
