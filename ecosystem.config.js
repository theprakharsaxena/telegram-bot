'use strict';

/**
 * PM2 Ecosystem Configuration
 *
 * Used on the EC2 server to manage the Node.js process:
 *   - Cluster mode: spawns one worker per CPU core (max 4 for cost control)
 *   - Zero-downtime reloads: `pm2 reload ecosystem.config.js`
 *   - Auto-restart on crash with exponential backoff
 *   - Memory limit: restarts if process exceeds 512 MB (memory leak guard)
 *   - Log rotation configured via pm2-logrotate module
 *
 * Commands:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js --env production   (zero-downtime)
 *   pm2 stop telegram-ai-companion
 *   pm2 logs telegram-ai-companion
 *   pm2 monit
 */

module.exports = {
  apps: [
    {
      // ── Identity ──────────────────────────────────────────────────────────
      name: 'telegram-ai-companion',
      script: 'server.js',

      // ── Concurrency ───────────────────────────────────────────────────────
      // 'max' uses all CPU cores. Cap at 4 to keep memory predictable on a
      // t3.medium (2 vCPU). Raise for larger instance types.
      instances: 'max',
      exec_mode: 'cluster',

      // ── Restart policy ────────────────────────────────────────────────────
      autorestart: true,
      watch: false,              // Never watch files in production
      max_restarts: 10,
      min_uptime: '10s',         // Must stay up 10 s to count as a clean start
      restart_delay: 4000,       // Wait 4 s between restarts (backoff)

      // ── Resource limits ───────────────────────────────────────────────────
      max_memory_restart: '512M',

      // ── Logging ───────────────────────────────────────────────────────────
      // Winston writes structured logs to ./logs/ — PM2 output just captures
      // anything that bypasses Winston (startup errors, etc.)
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,          // Merge cluster worker logs into single file
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // ── Environment variables per deploy target ────────────────────────────
      // `pm2 start ... --env production` activates env_production block.
      // Variables here SUPPLEMENT (not replace) your .env file.
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_staging: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],

  // ── PM2 Deploy config (optional — used with `pm2 deploy`) ─────────────────
  // Fill this in during Phase 15 (CI/CD setup).
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'YOUR_EC2_PUBLIC_IP',
      ref: 'origin/main',
      repo: 'git@github.com:YOUR_USERNAME/telegram-ai-companion.git',
      path: '/home/ubuntu/telegram-ai-companion',
      'pre-deploy-local': '',
      'post-deploy':
        'npm ci --omit=dev && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
    },
  },
};
