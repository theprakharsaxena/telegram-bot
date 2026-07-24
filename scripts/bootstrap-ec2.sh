#!/usr/bin/env bash
# =============================================================================
# EC2 Bootstrap Script
# Run once on a fresh Ubuntu 22.04 LTS instance as the ubuntu user.
#
# Usage:
#   chmod +x bootstrap-ec2.sh
#   sudo bash bootstrap-ec2.sh
#
# What it installs:
#   - System updates
#   - Node.js 20 LTS (via NodeSource)
#   - Redis 7
#   - Nginx
#   - PM2
#   - Certbot
#   - Git
#   - UFW firewall rules
# =============================================================================

set -euo pipefail

echo ""
echo "======================================================"
echo "  Telegram AI Companion — EC2 Bootstrap"
echo "======================================================"
echo ""

# ---------------------------------------------------------------------------
# 1. System update
# ---------------------------------------------------------------------------
echo "→ Updating system packages…"
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
    curl wget git build-essential \
    software-properties-common \
    ufw fail2ban

# ---------------------------------------------------------------------------
# 2. Node.js 20 LTS
# ---------------------------------------------------------------------------
echo "→ Installing Node.js 20 LTS…"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version
npm --version

# ---------------------------------------------------------------------------
# 3. PM2 (global)
# ---------------------------------------------------------------------------
echo "→ Installing PM2…"
npm install -g pm2
pm2 --version

# ---------------------------------------------------------------------------
# 4. Redis 7
# ---------------------------------------------------------------------------
echo "→ Installing Redis…"
apt-get install -y redis-server

# Secure Redis: bind to localhost only, set a password
REDIS_PASSWORD=$(openssl rand -hex 32)
echo ""
echo "  ⚠️  Redis password generated. SAVE THIS — you'll need it in .env:"
echo "  REDIS_PASSWORD=${REDIS_PASSWORD}"
echo ""

# Update Redis config
sed -i 's/^bind .*/bind 127.0.0.1 -::1/' /etc/redis/redis.conf
sed -i 's/^# requirepass .*/requirepass '"${REDIS_PASSWORD}"'/' /etc/redis/redis.conf
sed -i 's/^requirepass .*/requirepass '"${REDIS_PASSWORD}"'/' /etc/redis/redis.conf

# Enable and start Redis
systemctl enable redis-server
systemctl restart redis-server

# Verify Redis is running
redis-cli -a "${REDIS_PASSWORD}" ping | grep -q PONG && echo "  ✅ Redis is running" || echo "  ❌ Redis check failed"

# ---------------------------------------------------------------------------
# 5. Nginx
# ---------------------------------------------------------------------------
echo "→ Installing Nginx…"
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx

# ---------------------------------------------------------------------------
# 6. Certbot (Let's Encrypt)
# ---------------------------------------------------------------------------
echo "→ Installing Certbot…"
apt-get install -y certbot python3-certbot-nginx

# ---------------------------------------------------------------------------
# 7. UFW Firewall
# ---------------------------------------------------------------------------
echo "→ Configuring firewall…"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh        # Port 22
ufw allow 80/tcp     # HTTP (needed for Certbot challenge)
ufw allow 443/tcp    # HTTPS
ufw --force enable
ufw status

# ---------------------------------------------------------------------------
# 8. fail2ban (brute-force protection)
# ---------------------------------------------------------------------------
echo "→ Configuring fail2ban…"
systemctl enable fail2ban
systemctl start fail2ban

# ---------------------------------------------------------------------------
# 9. Create app directory
# ---------------------------------------------------------------------------
echo "→ Creating app directory…"
mkdir -p /home/ubuntu/telegram-bot
chown ubuntu:ubuntu /home/ubuntu/telegram-bot

# ---------------------------------------------------------------------------
# 10. PM2 startup (auto-restart on reboot)
# ---------------------------------------------------------------------------
echo "→ Configuring PM2 startup…"
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# Note: PM2 will print a command to run — execute it manually after this script

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "======================================================"
echo "  Bootstrap complete!"
echo "======================================================"
echo ""
echo "  ✅ Node.js $(node --version)"
echo "  ✅ npm $(npm --version)"
echo "  ✅ PM2 $(pm2 --version)"
echo "  ✅ Redis installed (bound to 127.0.0.1)"
echo "  ✅ Nginx installed"
echo "  ✅ Certbot installed"
echo "  ✅ UFW firewall active (22, 80, 443)"
echo ""
echo "  IMPORTANT — Save this Redis password in your .env:"
echo "  REDIS_PASSWORD=${REDIS_PASSWORD}"
echo ""
echo "  Next steps:"
echo "  1. Push your code to GitHub"
echo "  2. git clone your repo to /home/ubuntu/telegram-bot"
echo "  3. cp .env.production.example .env  — fill in all values"
echo "  4. npm ci --omit=dev"
echo "  5. pm2 start ecosystem.config.js --env production"
echo "  6. Configure Nginx (copy scripts/nginx.conf)"
echo "  7. Run certbot --nginx -d YOUR_DOMAIN"
echo ""
