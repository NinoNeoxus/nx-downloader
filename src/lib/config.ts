// Central application configuration and dynamic branding
export const SITE_CONFIG = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || 'NX Downloader',
  description:
    process.env.NEXT_PUBLIC_SITE_DESC ||
    'High-Performance Universal Video & Audio Downloader for YouTube, TikTok, Instagram, and Facebook.',
  domain: process.env.NEXT_PUBLIC_DOMAIN || process.env.DOMAIN || 'localhost:3000',
  get url() {
    const rawUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (rawUrl) return rawUrl.replace(/\/$/, '');
    const d = this.domain;
    if (d.startsWith('http://') || d.startsWith('https://')) {
      return d.replace(/\/$/, '');
    }
    const isLocal = d.includes('localhost') || d.includes('127.0.0.1');
    return isLocal ? `http://${d}` : `https://${d}`;
  },
  adGate: {
    enabled: process.env.NEXT_PUBLIC_AD_GATE_ENABLED === 'true',
    directUrl: process.env.NEXT_PUBLIC_AD_DIRECT_URL || '',
  },
};
