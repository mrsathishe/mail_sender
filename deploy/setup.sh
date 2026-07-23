#!/usr/bin/env bash
# One-time setup on the VPS. Run AFTER cloning the repo into your home folder.
# Generates a systemd service that runs the Next.js server in place (as your
# user), so nothing needs to be moved into /opt. Run from the project root:
#   npm run setup   (or:  bash deploy/setup.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_USER="$(whoami)"
NODE_BIN="$(command -v node)"
SERVICE="/etc/systemd/system/mail-sender.service"

echo "==> Installing dependencies (incl. dev — needed to build)"
npm --prefix "$APP_DIR" ci

if [ ! -f "$APP_DIR/.env" ]; then
  echo "==> Creating .env from template — edit it (AUTH_SECRET, MONGO_URI, SMTP_*) before starting!"
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi

echo "==> Building the Next.js app"
npm --prefix "$APP_DIR" run build

echo "==> Installing systemd service (user=$RUN_USER, dir=$APP_DIR, node=$NODE_BIN)"
sudo tee "$SERVICE" > /dev/null <<EOF
[Unit]
Description=Mail Sender (Next.js)
After=network.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
# Secrets (AUTH_SECRET, MONGO_URI, SMTP_*) are read from the repo's .env file.
EnvironmentFile=$APP_DIR/.env
Environment=NODE_ENV=production
Environment=HOSTNAME=127.0.0.1
Environment=PORT=3000
ExecStart=$NODE_BIN $APP_DIR/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mail-sender

echo "==> Done. App running on 127.0.0.1:3000"
echo "    Check with:  sudo systemctl status mail-sender"
