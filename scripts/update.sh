#!/usr/bin/env bash
# =============================================================================
# update.sh — Zero-downtime update script
# Run on EC2 to pull latest code and reload PM2 without dropping connections.
#
# Usage:
#   ./scripts/update.sh
#
# What it does:
#   1. git pull latest code
#   2. npm ci --omit=dev (only installs if package-lock changed)
#   3. pm2 reload (zero-downtime rolling restart across cluster workers)
# =============================================================================

set -euo pipefail

APP_DIR="/home/ubuntu/telegram-bot"
cd "${APP_DIR}"

echo ""
echo "→ Pulling latest code…"
git pull origin main

echo "→ Installing/updating dependencies…"
npm ci --omit=dev

echo "→ Validating config…"
node scripts/check-env.js

echo "→ Reloading PM2 (zero-downtime)…"
pm2 reload ecosystem.config.js --env production

echo "→ Saving PM2 state…"
pm2 save

echo ""
echo "✅ Update complete. Current status:"
pm2 status
echo ""
