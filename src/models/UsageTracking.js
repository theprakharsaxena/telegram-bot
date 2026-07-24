'use strict';

/**
 * UsageTracking Model
 *
 * Tracks per-user daily usage counters — messages sent and images generated.
 * One document per user per UTC calendar day.
 *
 * Design decisions:
 *   - One document per user per day (not cumulative) makes the "has this
 *     user hit their daily limit?" query O(1): fetch today's doc and compare.
 *   - date is stored as a UTC date-only string ('YYYY-MM-DD') so timezone
 *     handling is explicit and the compound index (telegramId + date) is unique.
 *   - Atomic $inc operations ensure concurrent message handlers don't race
 *     on the same counter (MongoDB guarantees atomicity at the document level).
 *   - TTL index auto-deletes documents older than 90 days to keep the
 *     collection lean (we aggregate into Analytics before deletion).
 */

const mongoose = require('mongoose');

const usageTrackingSchema = new mongoose.Schema(
  {
    // ── Identity ──────────────────────────────────────────────────────────
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    telegramId: {
      type: Number,
      required: true,
    },

    // ── Date bucket ───────────────────────────────────────────────────────
    // Format: 'YYYY-MM-DD' UTC — e.g. '2025-01-15'
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    // Full Date object version — used by TTL index
    dateObj: {
      type: Date,
      required: true,
    },

    // ── Plan context ──────────────────────────────────────────────────────
    // Snapshot of the user's plan on this day (for analytics)
    plan: {
      type: String,
      enum: ['free', 'premium'],
      required: true,
    },

    // ── Counters ──────────────────────────────────────────────────────────
    messagesUsed: { type: Number, default: 0, min: 0 },
    imagesUsed: { type: Number, default: 0, min: 0 },

    // ── Limits (snapshot from config at time of first use) ─────────────────
    // Stored here so we can detect when an admin changed limits mid-day
    messageLimit: { type: Number, required: true },
    imageLimit: { type: Number, required: true },

    // ── Flags ─────────────────────────────────────────────────────────────
    // Set true when the user first hits their message limit (for notification)
    messageLimitNotified: { type: Boolean, default: false },
    imageLimitNotified: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Primary lookup: "what has user X used today?"
usageTrackingSchema.index({ telegramId: 1, date: 1 }, { unique: true });

// TTL: auto-delete raw tracking after 90 days
// (aggregated data lives in Analytics model forever)
usageTrackingSchema.index(
  { dateObj: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

/**
 * Get today's usage record for a user, creating it if it doesn't exist.
 * This is the core method called before every message/image request.
 *
 * @param {ObjectId} userId
 * @param {number}   telegramId
 * @param {string}   plan        — 'free' | 'premium'
 * @param {object}   limits      — { dailyMessages, dailyImages }
 * @returns {Document} UsageTracking document
 */
usageTrackingSchema.statics.getOrCreateToday = async function (
  userId,
  telegramId,
  plan,
  limits
) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const dateObj = new Date(date + 'T00:00:00.000Z');

  return this.findOneAndUpdate(
    { telegramId, date },
    {
      $setOnInsert: {
        userId,
        telegramId,
        date,
        dateObj,
        plan,
        messagesUsed: 0,
        imagesUsed: 0,
        messageLimit: limits.dailyMessages,
        imageLimit: limits.dailyImages,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/**
 * Atomically increment the message counter for today.
 * Returns the updated document — caller checks if limit is exceeded.
 */
usageTrackingSchema.statics.incrementMessages = function (telegramId, date) {
  return this.findOneAndUpdate(
    { telegramId, date },
    { $inc: { messagesUsed: 1 } },
    { new: true }
  );
};

/**
 * Atomically increment the image counter for today.
 */
usageTrackingSchema.statics.incrementImages = function (telegramId, date) {
  return this.findOneAndUpdate(
    { telegramId, date },
    { $inc: { imagesUsed: 1 } },
    { new: true }
  );
};

module.exports = mongoose.model('UsageTracking', usageTrackingSchema);
