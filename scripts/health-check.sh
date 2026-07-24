#!/usr/bin/env bash
# Load environment variables from .env
if [ -f "$(dirname "$0")/../.env" ]; then
    set -a
    source "$(dirname "$0")/../.env"
    set +a
fi
# =============================================================================
# health-check.sh — Production health verification script
# Run on the EC2 server to verify all components are healthy.
#
# Usage:
#   ./scripts/health-check.sh [domain]
#   ./scripts/health-check.sh api.mybotdomain.com
# =============================================================================

DOMAIN="${1:-localhost}"
APP_PORT="${APP_PORT:-3000}"
PASS=0
FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)); }
fail() { echo "  ❌ $1"; ((FAIL++)); }
info() { echo "  ℹ️  $1"; }

echo ""
echo "======================================================"
echo "  Health Check — $(date)"
echo "======================================================"
echo ""

# ---------------------------------------------------------------------------
# 1. PM2 process
# ---------------------------------------------------------------------------
echo "→ PM2 process:"
if pm2 show telegram-ai-companion 2>/dev/null | grep -q "online"; then
    ok "PM2 process is online"
    WORKERS=$(pm2 show telegram-ai-companion 2>/dev/null | grep -c "online" || echo 0)
    info "Workers: ${WORKERS}"
else
    fail "PM2 process not running — run: pm2 start ecosystem.config.js --env production"
fi

# ---------------------------------------------------------------------------
# 2. HTTP health endpoint (direct to Node)
# ---------------------------------------------------------------------------
echo ""
echo "→ Node.js HTTP health:"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${APP_PORT}/health" 2>/dev/null || echo "000")
if [ "${HTTP_STATUS}" = "200" ]; then
    ok "Node.js responding on port ${APP_PORT} (HTTP ${HTTP_STATUS})"
else
    fail "Node.js not responding (HTTP ${HTTP_STATUS})"
fi

# ---------------------------------------------------------------------------
# 3. Readiness probe (DB + Redis check)
# ---------------------------------------------------------------------------
echo ""
echo "→ Readiness probe:"
READY_RESP=$(curl -s "http://127.0.0.1:${APP_PORT}/health/ready" 2>/dev/null || echo "{}")
READY_STATUS=$(echo "${READY_RESP}" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
MONGO_OK=$(echo "${READY_RESP}" | grep -o '"mongodb":[a-z]*' | cut -d: -f2 || echo "false")
REDIS_OK=$(echo "${READY_RESP}" | grep -o '"redis":[a-z]*' | cut -d: -f2 || echo "false")

[ "${MONGO_OK}" = "true" ] && ok "MongoDB connected" || fail "MongoDB not connected"
[ "${REDIS_OK}" = "true" ] && ok "Redis connected"   || fail "Redis not connected"

# ---------------------------------------------------------------------------
# 4. Nginx
# ---------------------------------------------------------------------------
echo ""
echo "→ Nginx:"
if systemctl is-active --quiet nginx; then
    ok "Nginx is running"
else
    fail "Nginx is not running — run: sudo systemctl start nginx"
fi

# ---------------------------------------------------------------------------
# 5. HTTPS (if domain provided and not localhost)
# ---------------------------------------------------------------------------
if [ "${DOMAIN}" != "localhost" ]; then
    echo ""
    echo "→ HTTPS:"
    HTTPS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        "https://${DOMAIN}/health" \
        --max-time 10 2>/dev/null || echo "000")
    if [ "${HTTPS_STATUS}" = "200" ]; then
        ok "HTTPS working (${DOMAIN})"
    else
        fail "HTTPS not responding (HTTP ${HTTPS_STATUS}) — SSL configured?"
    fi

    # SSL expiry check
    EXPIRY=$(echo | openssl s_client -servername "${DOMAIN}" \
        -connect "${DOMAIN}:443" 2>/dev/null \
        | openssl x509 -noout -enddate 2>/dev/null \
        | cut -d= -f2 || echo "unknown")
    [ "${EXPIRY}" != "unknown" ] && info "SSL expires: ${EXPIRY}"
fi

# ---------------------------------------------------------------------------
# 6. Redis directly
# ---------------------------------------------------------------------------
echo ""
echo "→ Redis:"
if command -v redis-cli &>/dev/null; then
    # Try without password first, then with
    REDIS_PING=$(redis-cli ping 2>/dev/null || redis-cli -a "${REDIS_PASSWORD:-}" ping 2>/dev/null || echo "failed")
    [ "${REDIS_PING}" = "PONG" ] && ok "Redis PING → PONG" || fail "Redis not responding"
else
    info "redis-cli not found, skipping direct check"
fi

# ---------------------------------------------------------------------------
# 7. Disk space
# ---------------------------------------------------------------------------
echo ""
echo "→ Disk space:"
DISK_USE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "${DISK_USE:-0}" -lt 80 ] 2>/dev/null; then
    ok "Disk usage: ${DISK_USE}%"
else
    fail "Disk usage high: ${DISK_USE}% — clean up logs or increase volume"
fi

# ---------------------------------------------------------------------------
# 8. Log files
# ---------------------------------------------------------------------------
echo ""
echo "→ Recent errors (last 5 lines of error log):"
ERROR_LOG="/home/ubuntu/telegram-bot/logs/pm2-error.log"
if [ -f "${ERROR_LOG}" ]; then
    tail -5 "${ERROR_LOG}" | sed 's/^/    /'
else
    info "No error log found at ${ERROR_LOG}"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "======================================================"
TOTAL=$((PASS + FAIL))
if [ "${FAIL}" -eq 0 ]; then
    echo "  ✅ All ${TOTAL} checks passed"
else
    echo "  ⚠️  ${PASS}/${TOTAL} passed, ${FAIL} failed"
fi
echo "======================================================"
echo ""

exit "${FAIL}"
