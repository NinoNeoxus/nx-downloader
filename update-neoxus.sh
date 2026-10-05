#!/usr/bin/env bash
# Public bootstrap; source aplikasi dan kredensial tetap pada repo/VPS private.
set -Eeuo pipefail

if (( EUID != 0 )); then
  echo 'Jalankan sebagai root, atau gunakan curl ... | sudo bash.' >&2
  exit 1
fi
APP_DIR="${APP_DIR:-/opt/neoxus}"
if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Instalasi Git tidak ditemukan di $APP_DIR. Atur APP_DIR jika lokasinya berbeda." >&2
  exit 1
fi
command -v git >/dev/null || { echo 'Git belum terpasang.' >&2; exit 1; }
UPDATE_SCRIPT="$(mktemp)"
trap 'rm -f -- "$UPDATE_SCRIPT"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo '[neoxus] Mengambil updater dengan akses Git yang tersimpan di VPS...'
GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" fetch --quiet origin main
git -C "$APP_DIR" show FETCH_HEAD:scripts/update-vps.sh > "$UPDATE_SCRIPT"
bash -n "$UPDATE_SCRIPT"
bash "$UPDATE_SCRIPT"
