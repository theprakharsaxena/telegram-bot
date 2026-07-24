'use strict';

/**
 * Rate Limiting Middleware
 *
 * Two layers of protection:
 *
 *   1. IP-based limiter   — protects the webhook endpoint from flood attacks
 *                           even before we know who the user is.
 *                           Max 120 req/min per IP.
 *
 *   2. Webhook limiter    — tighter limit on the webhook path specifically.
 *                           Max 60 req/min per IP (Telegram itself is the
 *                           only caller in production, so this rarely fires).
 *
 * Why not user-based rate limiting here?
 *   Per-user daily limits are enforced inside UsageService (Redis counters).
 *   Express-level limiting is only for infrastructure protection — blocking
 *   bots/scrapers before they reach our application code.
 *
 * The RedisStore makes limits survive server restarts and work across
 * multiple PM2 cluster workers.
 */

const rateLimit  = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { redisClient } = require('../config/redis');
const logger     = require('../utils/logger');

// ---------------------------------------------------------------------------
// Helper: build a RedisStore for a given prefix
// ---------------------------------------------------------------------------
function makeRedisStore(prefix) {
  return new RedisStore({
    // rate-limit-redis expects a send_command function
    sendCommand: (...args) => redisClient.call(...args),
    prefix: `rl:${prefix}:`,
  });
}

// ---------------------------------------------------------------------------
// 1. General API rate limiter — applied to all routes
// ---------------------------------------------------------------------------
const generalLimiter = rateLimit({
  windowMs:         60 * 1000,   // 1 minute
  max:              120,          // 120 requests per minute per IP
  standardHeaders:  true,
  legacyHeaders:    false,
  store:            makeRedisStore('general'),
  keyGenerator:     (req) => req.ip,
  handler: (req, res) => {
    logger.warn('General rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({
      status:  'fail',
      message: 'Too many requests. Please slow down.',
    });
  },
  skip: (req) => req.path === '/health', // never rate-limit health checks
});

// ---------------------------------------------------------------------------
// 2. Webhook-specific limiter — tighter, protects the bot update path
// ---------------------------------------------------------------------------
const webhookLimiter = rateLimit({
  windowMs:        60 * 1000,  // 1 minute
  max:             60,          // 60 updates per minute per IP
  standardHeaders: true,
  legacyHeaders:   false,
  store:           makeRedisStore('webhook'),
  keyGenerator:    (req) => req.ip,
  handler: (req, res) => {
    logger.warn('Webhook rate limit exceeded', { ip: req.ip });
    // Must return 200 to Telegram — if we return 429, Telegram will retry
    // and make the problem worse. Silently drop instead.
    res.sendStatus(200);
  },
});

// ---------------------------------------------------------------------------
// 3. Admin route limiter — strict, protects the dashboard
// ---------------------------------------------------------------------------
const adminLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             100,             // 100 requests per 15 min per IP
  standardHeaders: true,
  legacyHeaders:   false,
  store:           makeRedisStore('admin'),
  keyGenerator:    (req) => req.ip,
  handler: (req, res) => {
    logger.warn('Admin rate limit exceeded', { ip: req.ip });
    res.status(429).json({
      status:  'fail',
      message: 'Too many requests to admin. Please wait.',
    });
  },
});

module.exports = { generalLimiter, webhookLimiter, adminLimiter };
