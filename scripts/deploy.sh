#!/usr/bin/env bash
# =============================================================================
# deploy.sh — First-time deployment script
# Run on the EC2 server as the ubuntu user AFTER bootstrap-ec2.sh completes.
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# Prerequisites:
#   - bootstrap-ec2.sh has been run
#   - Your repo is on GitHub
#   - .env file exists at /home/ubuntu/telegram-bot/.env
# =============================================================================

set -euo pipefail

APP_DIR="/home/ubuntu/telegram-bot"
REPO_URL="YOUR_GITHUB_REPO_URL"   # e.g. https://github.com/youruser/telegram-bot.git
DOMAIN="YOUR_DOMAIN"               # e.g. api.mybotdomain.com

echo ""
echo "======================================================"
echo "  Telegram Bot — Initial Deployment"
echo "======================================================"
echo ""

# ---------------------------------------------------------------------------
# 1. Clone repo (skip if already cloned)
# ---------------------------------------------------------------------------
if [ ! -d "${APP_DIR}/.git" ]; then
    echo "→ Cloning repository…"
    git clone "${REPO_URL}" "${APP_DIR}"
else
    echo "→ Repo already cloned. Pulling latest…"
    cd "${APP_DIR}"
    git pull origin main
fi

cd "${APP_DIR}"

# ---------------------------------------------------------------------------
# 2. Verify .env exists
# ---------------------------------------------------------------------------
if [ ! -f ".env" ]; then
    echo "❌ .env file not found at ${APP_DIR}/.env"
    echo "   Copy .env.production.example to .env and fill in all values first."
    exit 1
fi

echo "✅ .env file found"

# ---------------------------------------------------------------------------
# 3. Install production dependencies only
# ---------------------------------------------------------------------------
echo "→ Installing dependencies (production only)…"
npm ci --omit=dev

# ---------------------------------------------------------------------------
# 4. Create logs directory
# ---------------------------------------------------------------------------
mkdir -p logs
echo "✅ Logs directory ready"

# ---------------------------------------------------------------------------
# 5. Validate config before starting
# ---------------------------------------------------------------------------
echo "→ Validating configuration…"
node scripts/check-env.js

# ---------------------------------------------------------------------------
# 6. Start app with PM2
# ---------------------------------------------------------------------------
echo "→ Starting app with PM2…"
pm2 start ecosystem.config.js --env production

# ---------------------------------------------------------------------------
# 7. Save PM2 process list for auto-restart on reboot
# ---------------------------------------------------------------------------
pm2 save
echo "✅ PM2 process list saved"

# ---------------------------------------------------------------------------
# 8. Configure Nginx
# ---------------------------------------------------------------------------
echo "→ Setting up Nginx config…"
# Inject real domain into nginx config
sed "s/YOUR_DOMAIN/${DOMAIN}/g" scripts/nginx.conf \
    > /etc/nginx/sites-available/telegram-bot

ln -sf /etc/nginx/sites-available/telegram-bot \
       /etc/nginx/sites-enabled/telegram-bot

# Remove default site
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
echo "✅ Nginx configured"

# ---------------------------------------------------------------------------
# 9. Print status
# ---------------------------------------------------------------------------
echo ""
echo "======================================================"
echo "  Deployment complete!"
echo "======================================================"
pm2 status
echo ""
echo "  Next: obtain SSL certificate"
echo "  Run: sudo certbot --nginx -d ${DOMAIN}"
echo ""
