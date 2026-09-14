#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║                    NX DOWNLOADER AUTO-DEPLOY SCRIPT                         ║
# ║          Universal High-Speed Media Downloader Installation                 ║
# ║                                                                             ║
# ║  Usage:                                                                     ║
# ║    curl -sSL https://raw.githubusercontent.com/NinoNeoxus/nx-downloader/main/deploy.sh | bash  ║
# ║                                                                             ║
# ║  Supported OS: Ubuntu 20.04 / 22.04 / 24.04 / Debian 11 / 12                ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

set -e

# Support interactive terminal input when piped via `curl ... | bash`
if [ -c /dev/tty ]; then
  exec < /dev/tty
fi

# ─── Colors for Output ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
info()  { echo -e "${CYAN}[→]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ─── Pre-flight Checks ────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  error "Script ini harus dijalankan sebagai root! Gunakan: sudo bash atau login sebagai root."
fi

# Auto-detect Public IP
SERVER_IP=$(curl -s -4 ifconfig.me 2>/dev/null || curl -s -4 icanhazip.com 2>/dev/null || echo "127.0.0.1")

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     🚀 NX DOWNLOADER — INTERACTIVE SETUP WIZARD             ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# ─── Pertanyaan 1: Pengecekan Domain & VPS ────────────────────────────────────
echo -e "${YELLOW}[1/3] Pemeriksaan Koneksi Domain & VPS${NC}"
echo -e "      IP Publik Server VPS Anda saat ini: ${GREEN}${BOLD}${SERVER_IP}${NC}"
read -r -p "Apakah Domain Anda sudah terhubung (point DNS A-record) ke VPS ini? [y/N]: " IS_DOMAIN_POINTED

if [[ ! "$IS_DOMAIN_POINTED" =~ ^[Yy]$ ]]; then
  echo ""
  warn "Perhatian: Jika domain belum di-pointing, Anda tetap bisa melanjutkan instalasi."
  warn "Pastikan menambahkan DNS A-record di Cloudflare atau registrar domain Anda:"
  echo -e "       Host: @ (atau subdomain)  →  IP: ${GREEN}${SERVER_IP}${NC}"
  echo ""
  read -r -p "Lanjutkan proses instalasi sekarang? [Y/n]: " CONTINUE_ANYWAY
  if [[ "$CONTINUE_ANYWAY" =~ ^[Nn]$ ]]; then
    error "Instalasi dibatalkan oleh pengguna. Silakan pointing domain terlebih dahulu."
  fi
fi

# ─── Pertanyaan 2: Nama Domain ────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2/3] Nama Domain Website${NC}"
echo -e "      Masukkan domain yang akan digunakan untuk mengakses website."
read -r -p "Apa Nama domain kamu? (contoh: downloader.com / tekan Enter jika ingin gunakan IP ${SERVER_IP}): " INPUT_DOMAIN
DOMAIN="${INPUT_DOMAIN:-$SERVER_IP}"
# Hapus protokol jika pengguna tak sengaja mengetik https:// atau http://
DOMAIN=$(echo "$DOMAIN" | sed -e 's|^[^/]*//||' -e 's|/.*$||')

# ─── Pertanyaan 3: Kustomisasi Nama Brand / Website ───────────────────────────
echo ""
echo -e "${YELLOW}[3/3] Kustomisasi Nama Website & Brand${NC}"
echo -e "      Nama ini akan otomatis muncul pada Navbar, Hero Header, dan Footer website."
read -r -p "Mau diberi nama apa web ini? (contoh: MediaSnap / tekan Enter untuk 'NX Downloader'): " INPUT_SITE_NAME
SITE_NAME="${INPUT_SITE_NAME:-NX Downloader}"

# ─── Ringkasan Konfigurasi ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}Konfigurasi Yang Dipilih:${NC}"
echo -e "  • Nama Website : ${CYAN}${SITE_NAME}${NC}"
echo -e "  • Domain       : ${CYAN}${DOMAIN}${NC}"
echo -e "  • Server IP    : ${CYAN}${SERVER_IP}${NC}"
echo -e "  • Target URL   : ${CYAN}http://${DOMAIN}${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════════${NC}"
echo ""

# Configuration constants
GITHUB_USER="NinoNeoxus"
GITHUB_REPO="nx-downloader"
REPO_URL="https://github.com/${GITHUB_USER}/${GITHUB_REPO}.git"
APP_DIR="/opt/nx-downloader"
NODE_MAJOR=20
APP_PORT=3000
SERVICE_NAME="nx-downloader"

# ─── Step 1: System Update ────────────────────────────────────────────────────
info "Step 1/9: Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" upgrade > /dev/null 2>&1
log "System updated!"

# ─── Step 2: Install Essential Packages ───────────────────────────────────────
info "Step 2/9: Installing essential packages (curl, git, ffmpeg, nginx, certbot)..."
apt-get install -y -qq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" \
  curl \
  wget \
  git \
  build-essential \
  ca-certificates \
  gnupg \
  python3 \
  python3-pip \
  dnsutils \
  nginx \
  certbot \
  python3-certbot-nginx \
  ffmpeg \
  unzip \
  > /dev/null 2>&1
log "Essential packages installed!"

# ─── Step 3: Install Node.js 20 LTS ───────────────────────────────────────────
info "Step 3/9: Installing Node.js ${NODE_MAJOR} LTS..."
if command -v node &> /dev/null; then
  CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$CURRENT_NODE" -ge "$NODE_MAJOR" ]; then
    log "Node.js $(node -v) sudah terinstall!"
  else
    warn "Node.js versi lama terdeteksi, mengupgrade..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - > /dev/null 2>&1
    apt-get install -y -qq nodejs > /dev/null 2>&1
  fi
else
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
fi
log "Node.js $(node -v) + npm $(npm -v) ready!"

# ─── Step 4: Install yt-dlp ───────────────────────────────────────────────────
info "Step 4/9: Installing latest yt-dlp binary..."
if command -v yt-dlp &> /dev/null; then
  log "yt-dlp sudah terinstall, updating..."
  yt-dlp -U > /dev/null 2>&1 || true
else
  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  chmod a+rx /usr/local/bin/yt-dlp
fi
log "yt-dlp $(yt-dlp --version) ready!"

# ─── Step 4b: Install Deno (YouTube EJS Challenge Solver) ─────────────────────
info "Step 4b: Installing Deno runtime for YouTube signature challenge solver..."
if ! command -v deno &> /dev/null; then
  curl -fsSL https://deno.land/install.sh | sh > /dev/null 2>&1
  cp /root/.deno/bin/deno /usr/local/bin/deno 2>/dev/null || true
fi
log "Deno $(deno --version 2>/dev/null | head -n1 || echo 'ready') ready!"

# ─── Step 5: Clone Repository ─────────────────────────────────────────────────
info "Step 5/9: Fetching project source code..."
if [ -d "$APP_DIR" ]; then
  warn "Directory $APP_DIR sudah ada, pulling latest update..."
  cd "$APP_DIR"
  git remote set-url origin "$REPO_URL" 2>/dev/null || true
  git pull origin main 2>/dev/null || true
else
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi
log "Repository ready in $APP_DIR!"

# ─── Step 6: Configure Environment & Build ────────────────────────────────────
info "Step 6/9: Menyesuaikan konfigurasi (.env) dengan nama website '${SITE_NAME}'..."
cd "$APP_DIR"

cat > .env << ENVEOF
DOWNLOADER_ENGINE=ytdlp
NEXT_PUBLIC_SITE_NAME="${SITE_NAME}"
DOMAIN="${DOMAIN}"
NEXT_PUBLIC_DOMAIN="${DOMAIN}"
NEXT_PUBLIC_APP_URL="https://${DOMAIN}"
ADMIN_PIN="${ADMIN_PIN:-9988}"
PORT=${APP_PORT}
NODE_ENV=production
NEXT_PUBLIC_AD_GATE_ENABLED=false
ENVEOF
log "File .env berhasil dibuat dengan kustomisasi website Anda!"

mkdir -p data/temp
chmod 755 data/temp

info "Installing dependencies (npm install)..."
npm install --production=false
log "Dependencies installed!"

info "Building production Next.js bundle..."
npm run build
log "Production build complete!"

# ─── Step 7: Create systemd Service ───────────────────────────────────────────
info "Step 7/9: Configuring systemd background daemon..."
NPM_BIN=$(command -v npm || echo "/usr/bin/npm")
cat > /etc/systemd/system/${SERVICE_NAME}.service << SERVICEEOF
[Unit]
Description=${SITE_NAME} Video Downloader
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=${NPM_BIN} start
Restart=always
RestartSec=3
StartLimitIntervalSec=60
StartLimitBurst=5

# Environment
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment=NODE_OPTIONS="--max-old-space-size=512"

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=${APP_DIR} /tmp

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}
log "Service '${SERVICE_NAME}' active and running!"

# Health check
info "Waiting for application to boot on port ${APP_PORT}..."
APP_OK=false
for i in $(seq 1 15); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${APP_PORT} || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "304" ] || [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "308" ]; then
    log "Application responding (HTTP $HTTP_CODE)!"
    APP_OK=true
    break
  fi
  sleep 2
done

if [ "$APP_OK" = false ]; then
  warn "Aplikasi belum merespon di port ${APP_PORT}. Cek log berikut:"
  journalctl -u ${SERVICE_NAME} -n 25 --no-pager || true
fi

# ─── Step 8: Configure Nginx Reverse Proxy ────────────────────────────────────
info "Step 8/9: Configuring Nginx reverse proxy for ${DOMAIN}..."
rm -f /etc/nginx/sites-enabled/default

# Generate Origin SSL Certificate (supports Cloudflare Full/Flexible SSL)
mkdir -p /etc/ssl/certs /etc/ssl/private
if [ ! -f "/etc/ssl/certs/nginx-selfsigned.crt" ]; then
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/ssl/private/nginx-selfsigned.key \
    -out /etc/ssl/certs/nginx-selfsigned.crt \
    -subj "/CN=${DOMAIN}" > /dev/null 2>&1
  log "Origin SSL certificate created!"
fi

cat > /etc/nginx/sites-available/${SERVICE_NAME} << NGINXEOF
# ${SITE_NAME} - Nginx Reverse Proxy
server {
    listen 80;
    listen [::]:80;
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN} www.${DOMAIN} _;

    ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;
    ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Large video transfers
    client_max_body_size 0;

    # High-throughput streaming timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 600s;
    proxy_read_timeout 600s;
    send_timeout 600s;

    # Disable proxy buffering for instant media streaming
    proxy_buffering off;
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/${SERVICE_NAME} /etc/nginx/sites-enabled/
nginx -t 2>&1 || error "Nginx configuration test failed!"
systemctl restart nginx
log "Nginx configured for ${DOMAIN} on ports 80 & 443!"

# ─── Step 9: Automatic SSL Setup ──────────────────────────────────────────────
info "Step 9/9: Checking SSL Configuration..."
if [[ "$IS_DOMAIN_POINTED" =~ ^[Yy]$ ]] && [ "$DOMAIN" != "$SERVER_IP" ]; then
  certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --email admin@${DOMAIN} --redirect 2>&1 || {
    warn "Certbot Let's Encrypt dilewati. Nginx tetap aktif melayani HTTPS dengan Origin SSL (Cloudflare Ready)."
  }
else
  log "Menggunakan Origin SSL Certificate (Otomatis kompatibel dengan Cloudflare Full SSL)."
fi

# ─── Complete Banner ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║             🎉 DEPLOYMENT BERHASIL! SELESAI 🎉               ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Nama Web   : ${BOLD}${SITE_NAME}${NC}"
echo -e "${GREEN}║${NC}  URL Web    : ${CYAN}http://${DOMAIN}${NC}"
echo -e "${GREEN}║${NC}  Direktori  : ${APP_DIR}"
echo -e "${GREEN}║${NC}  Status     : systemctl status ${SERVICE_NAME}"
echo -e "${GREEN}║${NC}  Logs       : journalctl -u ${SERVICE_NAME} -f"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}Admin Panel: http://${DOMAIN}/ops-panel-x99${NC}"
echo -e "${GREEN}║${NC}  ${CYAN}PIN Admin  : ${ADMIN_PIN:-9988} (Dapat diubah di .env)${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║${NC}  Perintah Berguna:                                           ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    systemctl restart ${SERVICE_NAME}   ← restart aplikasi       ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    systemctl stop ${SERVICE_NAME}      ← hentikan aplikasi      ${GREEN}║${NC}"
echo -e "${GREEN}║${NC}    journalctl -u ${SERVICE_NAME} -f    ← lihat live log         ${GREEN}║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
