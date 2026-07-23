#!/usr/bin/env bash
# One-command deploy. Run from the project root ON THE VPS:
#   npm run deploy   (or:  bash deploy/deploy.sh)
#
# Idempotent: the FIRST run installs the systemd service (via setup.sh);
# EVERY run then:
#   1. Installs/updates dependencies (incl. dev — needed to build).
#   2. Rebuilds the Next.js app.
#   3. Restarts the service so changes take effect.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# First-time bootstrap: install the systemd service if it isn't there yet.
SERVICE="/etc/systemd/system/mail-sender.service"
if [ ! -f "$SERVICE" ]; then
  echo "==> systemd service not found — running one-time setup first"
  bash "$SCRIPT_DIR/setup.sh"
  echo "==> Setup complete."
  exit 0
fi

echo "==> Installing dependencies"
npm --prefix "$APP_DIR" ci

echo "==> Building the Next.js app"
npm --prefix "$APP_DIR" run build

echo "==> Restarting service"
sudo systemctl restart mail-sender

echo "==> Done. Check:  sudo systemctl status mail-sender"
