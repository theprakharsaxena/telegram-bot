'use strict';

/**
 * UsageService
 *
 * Single source of truth for daily usage enforcement.
 *
 * Flow for every message:
 *   1. getOrCreateToday()     — upsert today's usage doc
 *   2. checkMessageLimit()    — is the user over their limit?
 *   3. (after AI responds)    — incrementMessages()
 *
 * Flow for every image:
 *   1. checkImageLimit()
 *   2. (after generation)     — incrementImages()
 *
 * All counters are atomically incremented in MongoDB so concurrent
 * requests from the same user can't race past the limit.
 *
 * Limits source of truth (priority order):
 *   AdminSettings.freeLimits / premiumLimits  (runtime, DB)
 *   → config.limits.free / premium            (env fallback)
 */

const { UsageTracking, AdminSettings } = require('../../models');
const { redisClient }                  = require('../../config/redis');
const config                           = require('../../config/env');
const logger                           = require('../../utils/logger');

// Cache key for today's usage (short TTL — must stay accurate)
const USAGE_CACHE_PREFIX = 'usage:today:';
const USAGE_CACHE_TTL    = 30; // seconds — short so limits are near-real-time

// Cache key for plan limits from AdminSettings
const LIMITS_CACHE_KEY = 'limits:config';
const LIMITS_CACHE_TTL = 120; // 2 minutes

// ---------------------------------------------------------------------------
// Limits loader
// ---------------------------------------------------------------------------

/**
 * Get effective plan limits — AdminSettings override env defaults.
 * Cached in Redis to avoid a DB read on every message.
 */
async function getLimits() {
  try {
    const cached = await redisClient.get(LIMITS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  const settings = await AdminSettings.getSettings();
  const limits = {
    free: {
      dailyMessages: settings.freeLimits?.dailyMessages    ?? config.limits.free.dailyMessages,
      dailyImages:   settings.freeLimits?.dailyImages      ?? config.limits.free.dailyImages,
      memoryLimit:   settings.freeLimits?.memoryLimit      ?? config.limits.free.memoryLimit,
    },
    premium: {
      dailyMessages: settings.premiumLimits?.dailyMessages ?? config.limits.premium.dailyMessages,
      dailyImages:   settings.premiumLimits?.dailyImages   ?? config.limits.premium.dailyImages,
      memoryLimit:   settings.premiumLimits?.memoryLimit   ?? config.limits.premium.memoryLimit,
    },
  };

  try {
    await redisClient.setex(LIMITS_CACHE_KEY, LIMITS_CACHE_TTL, JSON.stringify(limits));
  } catch (_) {}

  return limits;
}

// ---------------------------------------------------------------------------
// Today's usage record
// ---------------------------------------------------------------------------

/**
 * Get or create today's usage document for a user.
 * Returns the document — caller can read counters and limits from it.
 */
async function getOrCreateToday(userId, telegramId, plan) {
  const limits    = await getLimits();
  const planLimits = limits[plan] || limits.free;

  return UsageTracking.getOrCreateToday(userId, telegramId, plan, planLimits);
}

/**
 * Get today's usage, attempting Redis cache first.
 * Used for read-only display (e.g. /usage command).
 */
async function getTodayUsage(telegramId) {
  const today = new Date().toISOString().slice(0, 10);

  // Try cache
  const cacheKey = USAGE_CACHE_PREFIX + telegramId;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  const doc = await UsageTracking.findOne({ telegramId, date: today }).lean();

  if (doc) {
    try {
      await redisClient.setex(cacheKey, USAGE_CACHE_TTL, JSON.stringify(doc));
    } catch (_) {}
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Limit checks
// ---------------------------------------------------------------------------

/**
 * Check whether the user can send another message today.
 *
 * @returns {{ allowed: boolean, used: number, limit: number, resetAt: string }}
 */
async function checkMessageLimit(userId, telegramId, plan) {
  const usage = await getOrCreateToday(userId, telegramId, plan);
  const allowed = usage.messagesUsed < usage.messageLimit;

  return {
    allowed,
    used:    usage.messagesUsed,
    limit:   usage.messageLimit,
    resetAt: getResetTime(),
  };
}

/**
 * Check whether the user can generate another image today.
 */
async function checkImageLimit(userId, telegramId, plan) {
  const usage = await getOrCreateToday(userId, telegramId, plan);
  const allowed = usage.imagesUsed < usage.imageLimit;

  return {
    allowed,
    used:    usage.imagesUsed,
    limit:   usage.imageLimit,
    resetAt: getResetTime(),
  };
}

// ---------------------------------------------------------------------------
// Incrementers
// ---------------------------------------------------------------------------

/**
 * Increment today's message counter.
 * Returns updated { used, limit, isAtLimit }.
 */
async function incrementMessages(telegramId) {
  const today   = new Date().toISOString().slice(0, 10);
  const updated = await UsageTracking.incrementMessages(telegramId, today);

  // Invalidate cache
  await invalidateUsageCache(telegramId);

  if (!updated) return { used: 1, limit: 0, isAtLimit: false };

  const isAtLimit = updated.messagesUsed >= updated.messageLimit;

  // Flag first time hitting limit (for conversion nudge notification)
  if (isAtLimit && !updated.messageLimitNotified) {
    await UsageTracking.findOneAndUpdate(
      { telegramId, date: today },
      { $set: { messageLimitNotified: true } }
    );
  }

  return {
    used:      updated.messagesUsed,
    limit:     updated.messageLimit,
    isAtLimit,
  };
}

/**
 * Increment today's image counter.
 */
async function incrementImages(telegramId) {
  const today   = new Date().toISOString().slice(0, 10);
  const updated = await UsageTracking.incrementImages(telegramId, today);

  await invalidateUsageCache(telegramId);

  if (!updated) return { used: 1, limit: 0, isAtLimit: false };

  const isAtLimit = updated.imagesUsed >= updated.imageLimit;

  if (isAtLimit && !updated.imageLimitNotified) {
    await UsageTracking.findOneAndUpdate(
      { telegramId, date: today },
      { $set: { imageLimitNotified: true } }
    );
  }

  return {
    used:      updated.imagesUsed,
    limit:     updated.imageLimit,
    isAtLimit,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return a human-readable reset time string.
 * Limits reset at midnight UTC.
 */
function getResetTime() {
  const now     = new Date();
  const reset   = new Date();
  reset.setUTCHours(24, 0, 0, 0); // next UTC midnight
  const msLeft  = reset - now;
  const hLeft   = Math.floor(msLeft / 3600000);
  const mLeft   = Math.floor((msLeft % 3600000) / 60000);
  return `${hLeft}h ${mLeft}m`;
}

async function invalidateUsageCache(telegramId) {
  try {
    await redisClient.del(USAGE_CACHE_PREFIX + telegramId);
  } catch (_) {}
}

/**
 * Build the limit-exceeded message shown to free users.
 */
function buildLimitExceededMessage(type, used, limit, resetAt, isPremium) {
  if (isPremium) {
    // Premium users should never see this, but just in case
    return `You've used all ${limit} ${type}s for today. Resets in ${resetAt}.`;
  }

  const typeLabel = type === 'message' ? 'messages' : 'images';
  return (
    `⏰ <b>Daily ${type} limit reached!</b>\n\n` +
    `You've used <b>${used}/${limit}</b> free ${typeLabel} today.\n` +
    `Resets in <b>${resetAt}</b> (midnight UTC)\n\n` +
    `⭐ <b>Want unlimited ${typeLabel}?</b>\n` +
    `Upgrade to Premium with /premium and never hit a limit again!`
  );
}

module.exports = {
  getLimits,
  getOrCreateToday,
  getTodayUsage,
  checkMessageLimit,
  checkImageLimit,
  incrementMessages,
  incrementImages,
  getResetTime,
  buildLimitExceededMessage,
};
