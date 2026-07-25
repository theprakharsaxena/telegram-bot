'use strict';

/**
 * Analytics Model
 *
 * Stores pre-aggregated daily statistics for the admin dashboard.
 * One document per UTC calendar day.
 *
 * Design decisions:
 *   - Pre-aggregated (not computed on-demand) so dashboard queries are
 *     instant — no expensive aggregations on large collections at read time.
 *   - A nightly cron job (Phase 11) rolls up UsageTracking + Payment data
 *     into this collection and then can safely delete old UsageTracking records.
 *   - Stored indefinitely (no TTL) — this is our long-term analytics store.
 */

const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema(
  {
    // ── Date bucket ───────────────────────────────────────────────────────
    date: {
      type: String,
      required: true,
      unique: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
      index: true,
    },

    // ── User stats ────────────────────────────────────────────────────────
    totalUsers: { type: Number, default: 0 },
    newUsers: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 }, // users who sent ≥1 message
    premiumUsers: { type: Number, default: 0 },
    bannedUsers: { type: Number, default: 0 },

    // ── Message stats ─────────────────────────────────────────────────────
    totalMessages: { type: Number, default: 0 },
    userMessages: { type: Number, default: 0 },
    botMessages: { type: Number, default: 0 },
    freeUserMessages: { type: Number, default: 0 },
    premiumUserMessages: { type: Number, default: 0 },

    // ── Image stats ───────────────────────────────────────────────────────
    totalImagesGenerated: { type: Number, default: 0 },
    imagesSucceeded: { type: Number, default: 0 },
    imagesFailed: { type: Number, default: 0 },
    freeUserImages: { type: Number, default: 0 },
    premiumUserImages: { type: Number, default: 0 },

    // ── Revenue stats ─────────────────────────────────────────────────────
    paymentsCompleted: { type: Number, default: 0 },
    totalStarsEarned: { type: Number, default: 0 },
    dailySubscriptionsSold: { type: Number, default: 0 },
    weeklySubscriptionsSold: { type: Number, default: 0 },
    monthlySubscriptionsSold: { type: Number, default: 0 },
    subscriptionsExpired: { type: Number, default: 0 },
    subscriptionsCanceled: { type: Number, default: 0 },

    // ── AI cost estimates ─────────────────────────────────────────────────
    totalPromptTokens: { type: Number, default: 0 },
    totalCompletionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    // Estimated cost in USD (computed from token counts)
    estimatedCostUsd: { type: Number, default: 0 },

    // ── Limit hits ────────────────────────────────────────────────────────
    // How many users hit their message limit today (conversion funnel metric)
    messageLimitHits: { type: Number, default: 0 },
    imageLimitHits: { type: Number, default: 0 },

    // ── Error tracking ────────────────────────────────────────────────────
    totalErrors: { type: Number, default: 0 },
    aiErrors: { type: Number, default: 0 },
    imageErrors: { type: Number, default: 0 },
    paymentErrors: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Dashboard time-series queries
analyticsSchema.index({ date: -1 });

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

/**
 * Get or create today's analytics record.
 * The nightly job uses this to upsert aggregated data.
 */
analyticsSchema.statics.getOrCreateToday = function () {
  const date = new Date().toISOString().slice(0, 10);
  return this.findOneAndUpdate(
    { date },
    { $setOnInsert: { date } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Increment a specific counter atomically.
 * Used by event-driven updates (e.g. increment newUsers on user registration).
 * @param {string} date   — 'YYYY-MM-DD'
 * @param {object} fields — { newUsers: 1, totalMessages: 1, ... }
 */
analyticsSchema.statics.increment = function (date, fields) {
  const inc = {};
  Object.keys(fields).forEach((k) => {
    inc[k] = fields[k];
  });
  return this.findOneAndUpdate(
    { date },
    { $inc: inc },
    { upsert: true, new: true }
  );
};

/**
 * Get analytics for a date range (for dashboard charts).
 */
analyticsSchema.statics.getRange = function (startDate, endDate) {
  return this.find({
    date: { $gte: startDate, $lte: endDate },
  })
    .sort({ date: 1 })
    .lean();
};

module.exports = mongoose.model('Analytics', analyticsSchema);
