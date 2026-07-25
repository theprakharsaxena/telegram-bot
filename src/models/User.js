'use strict';

/**
 * User Model
 *
 * Central record for every person who starts the bot. Stores:
 *   - Telegram identity (immutable after first seen)
 *   - Plan status (free / premium)
 *   - Active personality selection
 *   - User preferences (language, notifications, etc.)
 *   - Soft-delete + ban support for moderation
 *
 * Design decisions:
 *   - telegramId is the natural key — stored as Number to match Telegram's API
 *   - plan + planExpiresAt live here so a single document read tells us
 *     everything we need for access control (no joins)
 *   - preferences is a sub-document (not a separate collection) because it is
 *     always read alongside the user — embedding avoids an extra round-trip
 */

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Sub-schema: Preferences
// ---------------------------------------------------------------------------
const preferencesSchema = new mongoose.Schema(
  {
    language: { type: String, default: 'en', maxlength: 10 },
    timezone: { type: String, default: 'UTC', maxlength: 50 },
    notificationsEnabled: { type: Boolean, default: true },
    // Whether the bot should simulate typing before responding
    typingSimulation: { type: Boolean, default: true },
    // Whether the user wants the AI to remember personal facts
    memoryEnabled: { type: Boolean, default: true },
    // Response style hint passed to the AI
    responseStyle: {
      type: String,
      enum: ['casual', 'romantic', 'friendly', 'professional'],
      default: 'casual',
    },
  },
  { _id: false } // embedded — no separate _id needed
);

// ---------------------------------------------------------------------------
// Sub-schema: Stats (denormalised counters for quick profile display)
// Updated by the usage tracking service, not directly by the user.
// ---------------------------------------------------------------------------
const statsSchema = new mongoose.Schema(
  {
    totalMessages: { type: Number, default: 0, min: 0 },
    totalImages: { type: Number, default: 0, min: 0 },
    totalConversations: { type: Number, default: 0, min: 0 },
    firstMessageAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: null },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main Schema
// ---------------------------------------------------------------------------
const userSchema = new mongoose.Schema(
  {
    // ── Telegram identity ──────────────────────────────────────────────────
    telegramId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    username: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },
    firstName: {
      type: String,
      trim: true,
      maxlength: 64,
      default: '',
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: 64,
      default: '',
    },
    languageCode: {
      type: String,
      maxlength: 10,
      default: 'en',
    },

    // ── Plan & subscription ────────────────────────────────────────────────
    plan: {
      type: String,
      enum: ['free', 'premium'],
      default: 'free',
      index: true,
    },
    planExpiresAt: {
      type: Date,
      default: null,
      // null = either free plan or lifetime premium
    },

    // ── Active personality ─────────────────────────────────────────────────
    // Stores the key of the currently selected personality (e.g. 'luna', 'aria')
    // Full personality definitions live in AdminSettings, not per-user.
    activePersonality: {
      type: String,
      default: 'sarah-23',
      maxlength: 32,
    },

    // ── Preferences & stats ───────────────────────────────────────────────
    preferences: {
      type: preferencesSchema,
      default: () => ({}),
    },
    stats: {
      type: statsSchema,
      default: () => ({}),
    },

    // ── Moderation ────────────────────────────────────────────────────────
    isBanned: { type: Boolean, default: false, index: true },
    banReason: { type: String, default: null, maxlength: 500 },
    bannedAt: { type: Date, default: null },

    // ── Soft delete ───────────────────────────────────────────────────────
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },

    // ── Admin flag ────────────────────────────────────────────────────────
    isAdmin: { type: Boolean, default: false },

    // ── Free trial tracking ───────────────────────────────────────────────
    trialUsed: { type: Boolean, default: false },
    trialStartedAt: { type: Date, default: null },

    // ── Custom plan credit overrides per user ─────────────────────────────
    customFreeMessages: { type: Number, default: null },
    customFreeImages: { type: Number, default: null },
  },
  {
    timestamps: true, // adds createdAt, updatedAt automatically
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------------------------------------------------------------------
// Indexes
// Compound indexes are ordered by selectivity (most selective field first).
// ---------------------------------------------------------------------------

// Used by the subscription expiry cleanup job
userSchema.index({ plan: 1, planExpiresAt: 1 });

// Used by admin analytics queries
userSchema.index({ createdAt: -1 });
userSchema.index({ 'stats.lastActiveAt': -1 });

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

/** Full display name — used in bot greetings */
userSchema.virtual('displayName').get(function () {
  const full = [this.firstName, this.lastName].filter(Boolean).join(' ').trim();
  return full || this.username || `User${this.telegramId}`;
});

/** True if the user has an active premium subscription */
userSchema.virtual('isPremium').get(function () {
  if (this.plan !== 'premium') return false;
  if (!this.planExpiresAt) return true; // lifetime
  return this.planExpiresAt > new Date();
});

// ---------------------------------------------------------------------------
// Instance methods
// ---------------------------------------------------------------------------

/**
 * Check if the user's premium has expired and downgrade if so.
 * Called lazily on each message; the subscription job also runs this nightly.
 */
userSchema.methods.checkAndExpirePremium = async function () {
  if (
    this.plan === 'premium' &&
    this.planExpiresAt &&
    this.planExpiresAt < new Date()
  ) {
    this.plan = 'free';
    this.planExpiresAt = null;
    await this.save();
    return true; // was expired
  }
  return false;
};

/**
 * Soft-delete the user's data (GDPR / user request).
 * Preserves the record for audit but clears PII.
 */
userSchema.methods.softDelete = async function () {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.firstName = '[deleted]';
  this.lastName = '';
  this.username = null;
  await this.save();
};

// ---------------------------------------------------------------------------
// Static methods
// ---------------------------------------------------------------------------

/**
 * Find by Telegram ID — the most common lookup in the entire app.
 * Returns null if not found (caller decides whether to create).
 */
userSchema.statics.findByTelegramId = function (telegramId) {
  return this.findOne({ telegramId, isDeleted: false });
};

/**
 * Upsert a user from a Telegram message's `from` object.
 * Creates on first visit, updates name/username on every visit.
 */
userSchema.statics.upsertFromTelegram = async function (from) {
  return this.findOneAndUpdate(
    { telegramId: from.id },
    {
      $set: {
        username: from.username || null,
        firstName: from.first_name || '',
        lastName: from.last_name || '',
        languageCode: from.language_code || 'en',
      },
      $setOnInsert: {
        telegramId: from.id,
        plan: 'free',
        'stats.firstMessageAt': new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  );
};

module.exports = mongoose.model('User', userSchema);
