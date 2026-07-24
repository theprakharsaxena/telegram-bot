'use strict';

/**
 * Admin Authentication Middleware
 *
 * Two auth modes:
 *   1. Session cookie  — for browser dashboard access (set after login POST)
 *   2. X-Admin-Key     — for programmatic API access (header-based)
 *
 * We use a simple in-memory session map backed by Redis.
 * No JWT or express-session dependency — keeps it lean.
 */

const { redisClient } = require('../config/redis');
const config          = require('../config/env');
const logger          = require('../utils/logger');
const crypto          = require('crypto');

const SESSION_PREFIX = 'admin:session:';
const SESSION_TTL    = 60 * 60 * 8; // 8 hours

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

async function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  await redisClient.setex(SESSION_PREFIX + token, SESSION_TTL, '1');
  return token;
}

async function validateSession(token) {
  if (!token) return false;
  const val = await redisClient.get(SESSION_PREFIX + token).catch(() => null);
  return val === '1';
}

async function destroySession(token) {
  if (!token) return;
  await redisClient.del(SESSION_PREFIX + token).catch(() => {});
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Protect admin routes.
 * Accepts either a valid session cookie or X-Admin-Key header.
 */
async function requireAdminAuth(req, res, next) {
  // API key auth (for scripts / CI)
  const apiKey = req.headers['x-admin-key'];
  if (apiKey && apiKey === config.admin.secretKey) {
    req.isAdmin = true;
    return next();
  }

  // Session cookie auth (for browser)
  const sessionToken = req.cookies?.admin_session;
  try {
    const valid = await validateSession(sessionToken);
    if (valid) {
      req.isAdmin = true;
      // Slide expiry on activity
      await redisClient.expire(SESSION_PREFIX + sessionToken, SESSION_TTL).catch(() => {});
      return next();
    }
  } catch (err) {
    logger.warn('Admin session check failed', { error: err.message });
  }

  // Not authenticated — redirect to login for browser, 401 for API
  if (req.headers.accept?.includes('application/json')) {
    return res.status(401).json({ status: 'fail', message: 'Admin authentication required' });
  }
  return res.redirect('/admin/login');
}

module.exports = { requireAdminAuth, createSession, destroySession };
