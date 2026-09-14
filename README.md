# 🚀 NX Downloader

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-14.2-black?style=for-the-badge&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)
![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8?style=for-the-badge&logo=tailwindcss)
![yt-dlp](https://img.shields.io/badge/Engine-yt--dlp-red?style=for-the-badge)
![FFmpeg](https://img.shields.io/badge/Transcoder-FFmpeg-green?style=for-the-badge&logo=ffmpeg)
![License](https://img.shields.io/badge/License-Community_Source-orange?style=for-the-badge)

**High-Performance Universal Video & Audio Extractor for YouTube, TikTok, Instagram, and Facebook.**

[Features](#-key-features) • [Interactive Installer](#-one-liner-interactive-vps-deploy) • [Quickstart](#-quickstart) • [Configuration](#-configuration--branding) • [License & Distribution](#-license--distribution-policy)

</div>

---

## ✨ Key Features

- 🎯 **Universal Platform Extraction**:
  - **YouTube**: All resolutions up to 4K / 1080p60 / 720p / 360p, high-fidelity MP3 / M4A audio extraction.
  - **TikTok**: HD clean video extraction without watermark, original sound extractor.
  - **Instagram**: Reels, Video posts, carousel clips, and background audio.
  - **Facebook**: Public SD and HD video streams.
- ⚡ **High-Speed Transcoder & Stream Muxer**:
  - Multi-threaded FFmpeg transcode pipeline with real-time SSE progress heartbeat.
  - Lossless audio stream copy (`-c:a copy`) when target container matches source codecs.
  - Fast MP3 compression via optimized libmp3lame preset with segmented parallel chunks.
- 🎨 **Dynamic Custom Branding**:
  - Customize website title, hero headline, navbar, and footer through environment variables (`NEXT_PUBLIC_SITE_NAME`).
  - Sleek glassmorphism cyber-dark UI built with Tailwind CSS.
- 🛡️ **Production-Grade Resilience & Security**:
  - **Built-in Ops & Monitoring Panel** (`/ops-panel-x99`) with PIN protection.
  - Dynamic IP rate limiting and brute-force/scraping protection.
  - Netscape cookie session manager for passing platform bot-challenges (YouTube sign-in confirmation, Instagram login gates).
  - YouTube JS challenge solver automated via Deno runtime.
- 🔀 **Dual Downloader Engine**:
  - Native `yt-dlp` binary engine or `Cobalt` API engine.

---

## 🛠️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Browser                         │
│           Next.js 14 App Router (React 18 + Tailwind)        │
└──────────────┬──────────────────────────────▲───────────────┘
               │ 1. URL Extract               │ 4. Direct Stream
               ▼                              │
┌─────────────────────────────────────────────────────────────┐
│                    Next.js API Gateway                      │
│     [/api/extract]  [/api/stream]  [/api/render-progress]   │
└──────────────┬──────────────────────────────▲───────────────┘
               │                              │
       ┌───────┴──────────────┐               │
       ▼                      ▼               │
┌──────────────┐      ┌──────────────┐        │
│    yt-dlp    │      │  FFmpeg Mux  ├────────┘
│    Engine    │      │  Transcoder  │
└──────┬───────┘      └──────────────┘
       │
       ▼
┌──────────────┐
│ Deno Runtime │ (YouTube Signature Challenge Solver)
└──────────────┘
```

---

## 🌐 One-Liner Interactive VPS Deploy

Deploy your own instance on Ubuntu 20.04 / 22.04 / 24.04 or Debian 11 / 12 using our interactive deployment wizard:

```bash
curl -sSL https://raw.githubusercontent.com/NinoNeoxus/nx-downloader/main/deploy.sh | bash
```

### Interactive Wizard Steps:
The installer will prompt you with three simple questions before starting:
1. **Domain Connection Check**: Confirms if your domain DNS A-record is already pointed to your VPS IP.
2. **Domain Name**: Sets your custom domain or falls back to your server's public IP address.
3. **Website Name / Branding**: Customizes the brand name displayed across the Navbar, Hero banner, and Footer (e.g. `MediaSnap`, `FastSave`).

The script automatically configures:
- Node.js 20 LTS, FFmpeg, yt-dlp, and Deno
- Next.js production build with your custom branding
- Systemd daemon (`nx-downloader.service`)
- Nginx reverse proxy with HTTP (80) & HTTPS (443) Origin SSL

---

## 🚀 Quickstart (Local Development)

### Prerequisites
- Node.js v20+
- FFmpeg installed and in `PATH`
- yt-dlp installed and in `PATH`
- Deno (optional, recommended for YouTube challenge solver)

### Steps
1. **Clone the official repository**:
   ```bash
   git clone https://github.com/NinoNeoxus/nx-downloader.git
   cd nx-downloader
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to set your desired `NEXT_PUBLIC_SITE_NAME` and `ADMIN_PIN`.

4. **Run development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚙️ Configuration & Branding

All configuration settings are managed via `.env`:

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_SITE_NAME` | `"NX Downloader"` | Brand name shown across Navbar, Hero, and Footer |
| `DOMAIN` | `localhost:3000` | Target domain or server IP |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Full canonical URL for sitemap and metadata |
| `ADMIN_PIN` | `9988` | PIN required to access `/ops-panel-x99` |
| `DOWNLOADER_ENGINE` | `ytdlp` | Backend engine (`ytdlp` or `cobalt`) |
| `NEXT_PUBLIC_AD_GATE_ENABLED` | `false` | Enable/disable ad verification modal for large files |
| `NEXT_PUBLIC_AD_DIRECT_URL` | `""` | Optional sponsor link when ad gate is enabled |
| `PORT` | `3000` | Port for the production web server |

---

## 🔐 Ops Panel & Cookie Management

Certain platforms (like YouTube bot verification or Instagram private media) require session cookies:

1. Navigate to `/ops-panel-x99` on your deployed site.
2. Enter your `ADMIN_PIN` (set in `.env`).
3. Under **Cookie Manager**, upload your browser cookies in Netscape format for YouTube, Instagram, or TikTok.
4. The system validates the cookie structure and hot-reloads it without restarting the server.

---

## 📜 License & Distribution Policy

This software is released under the **NX Downloader Community Source License with Sole Distribution Rights**.

- **Author & Maintainer**: **NinoNeoxus** ([@NinoNeoxus](https://github.com/NinoNeoxus))
- **Official Repository**: [https://github.com/NinoNeoxus/nx-downloader](https://github.com/NinoNeoxus/nx-downloader)

### Rights & Restrictions:
- ✅ **Permitted**: You are welcome to view, study, fork, modify, self-host, and contribute to this repository for personal, educational, or community use.
- ❌ **Prohibited**: You may **NOT** redistribute, re-upload, rebrand, or publish this codebase to public package registries, marketplace distributions, or mirrors without prior written permission and visible canonical attribution to the original author (`NinoNeoxus`).

For the full legal terms, please read the [LICENSE](LICENSE) file.

---

## ⚖️ Disclaimer

This software is intended for personal archiving, educational, and fair-use purposes only. Users are solely responsible for ensuring compliance with copyright laws and the terms of service of media providers.
