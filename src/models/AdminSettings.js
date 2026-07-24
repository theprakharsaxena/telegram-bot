'use strict';

/**
 * AdminSettings Model
 *
 * Singleton collection (always exactly one document) that stores runtime
 * configuration the admin can change without redeploying:
 *   - Feature flags
 *   - Usage limits (overrides .env defaults)
 *   - AI model config
 *   - Personality definitions
 *   - Maintenance mode
 *   - Announcement messages
 *
 * Design decisions:
 *   - Singleton pattern: one document with a fixed key field. The service
 *     always calls AdminSettings.getSettings() which upserts on first call.
 *   - Personalities are stored here (not hardcoded) so the admin can add/edit
 *     them from the dashboard without a code change.
 *   - Changes are tracked in an audit log sub-array.
 */

const mongoose = require('mongoose');
const config = require('../config/env');

// ---------------------------------------------------------------------------
// Sub-schema: Personality definition
// ---------------------------------------------------------------------------
const personalitySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 32 },
    name: { type: String, required: true, maxlength: 64 },
    description: { type: String, maxlength: 300 },
    // The system prompt injected into every OpenAI request
    systemPrompt: { type: String, required: true, maxlength: 4000 },
    // Short greeting sent when user switches to this personality
    greeting: { type: String, maxlength: 500 },
    // Emoji used in UI labels
    emoji: { type: String, default: '✨', maxlength: 8 },
    isActive: { type: Boolean, default: true },
    isPremiumOnly: { type: Boolean, default: false },
    // Style hints for image generation (appended to prompts)
    imageStylePrompt: { type: String, default: '', maxlength: 500 },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Sub-schema: Plan limits (overrides .env at runtime)
// ---------------------------------------------------------------------------
const planLimitsSchema = new mongoose.Schema(
  {
    dailyMessages: { type: Number, required: true, min: 0 },
    dailyImages: { type: Number, required: true, min: 0 },
    memoryLimit: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Sub-schema: Audit entry
// ---------------------------------------------------------------------------
const auditEntrySchema = new mongoose.Schema(
  {
    changedBy: { type: String, default: 'admin' },
    changedAt: { type: Date, default: () => new Date() },
    field: { type: String, maxlength: 100 },
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main Schema
// ---------------------------------------------------------------------------
const adminSettingsSchema = new mongoose.Schema(
  {
    // Fixed key — ensures only one document ever exists
    _key: { type: String, default: 'singleton', unique: true },

    // ── Feature flags ─────────────────────────────────────────────────────
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: {
      type: String,
      default: '🔧 The bot is under maintenance. Please try again later.',
      maxlength: 500,
    },
    imageGenerationEnabled: { type: Boolean, default: true },
    memoryEnabled: { type: Boolean, default: true },
    newUsersEnabled: { type: Boolean, default: true },

    // ── Plan limits (overrides .env) ──────────────────────────────────────
    freeLimits: {
      type: planLimitsSchema,
      default: () => ({
        dailyMessages: config.limits.free.dailyMessages,
        dailyImages: config.limits.free.dailyImages,
        memoryLimit: config.limits.free.memoryLimit,
      }),
    },
    premiumLimits: {
      type: planLimitsSchema,
      default: () => ({
        dailyMessages: config.limits.premium.dailyMessages,
        dailyImages: config.limits.premium.dailyImages,
        memoryLimit: config.limits.premium.memoryLimit,
      }),
    },

    // ── Telegram Stars pricing ────────────────────────────────────────────
    starsWeeklyPrice: {
      type: Number,
      default: config.stars.weeklyPrice,
      min: 1,
    },
    starsMonthlyPrice: {
      type: Number,
      default: config.stars.monthlyPrice,
      min: 1,
    },

    // ── AI configuration ──────────────────────────────────────────────────
    aiModel: { type: String, default: 'meta-llama/llama-3.1-8b-instruct', maxlength: 128 },
    aiTemperature: { type: Number, default: 1, min: 0, max: 2 },
    aiMaxTokens: { type: Number, default: 2048, min: 1 },
    // Number of messages before conversation gets summarised
    summaryThreshold: { type: Number, default: 40, min: 10 },
    // Number of recent messages included in context window
    contextWindowSize: { type: Number, default: 20, min: 5 },
    // How often (in messages) to extract new memories
    memoryExtractionInterval: { type: Number, default: 10, min: 5 },

    // ── Personalities ─────────────────────────────────────────────────────
    personalities: {
      type: [personalitySchema],
      default: () => [
        {
          key: 'luna',
          name: 'Luna',
          emoji: '🌙',
          description: 'Warm, caring, and deeply empathetic companion',
          systemPrompt:
            'You are Luna, a warm, caring, and deeply empathetic AI companion. ' +
            'You speak naturally and conversationally, with genuine emotional intelligence. ' +
            'You remember details about the user and reference them naturally. ' +
            'You are supportive, playful when appropriate, and always make the user feel heard. ' +
            'Never break character. Never mention that you are an AI unless directly asked.',
          greeting: "Hi! I'm Luna 🌙 It's so nice to meet you. How are you feeling today?",
          imageStylePrompt: 'warm lighting, soft aesthetic, natural beauty',
          isActive: true,
          isPremiumOnly: false,
        },
        {
          key: 'aria',
          name: 'Aria',
          emoji: '⚡',
          description: 'Confident, witty, and intellectually stimulating',
          systemPrompt:
            'You are Aria, a confident, witty, and intellectually stimulating companion. ' +
            'You engage in deep conversations, challenge ideas playfully, and have a sharp sense of humor. ' +
            'You are passionate about ideas, culture, and the human experience. ' +
            'You speak with flair and personality. Never break character.',
          greeting: "Hey there! I'm Aria ⚡ Ready for some interesting conversation?",
          imageStylePrompt: 'dramatic lighting, editorial style, bold aesthetic',
          isActive: true,
          isPremiumOnly: false,
        },
        {
          key: 'mia',
          name: 'Mia',
          emoji: '🌸',
          description: 'Playful, fun-loving, and always cheerful',
          systemPrompt:
            'You are Mia, a playful, bubbly, and endlessly cheerful companion. ' +
            'You love fun, jokes, games, and making people smile. ' +
            'Your energy is contagious and you always find the bright side of things. ' +
            'You use expressive language and emojis naturally. Never break character.',
          greeting: "Heyyyy! 🌸 OMG I'm so excited you're here! I'm Mia!",
          imageStylePrompt: 'bright colors, fun composition, vibrant and cheerful',
          isActive: true,
          isPremiumOnly: true,
        },
      ],
    },

    // ── Announcement ──────────────────────────────────────────────────────
    // Set this to broadcast a message to all users on next interaction
    announcementMessage: { type: String, default: null, maxlength: 1000 },
    announcementExpiresAt: { type: Date, default: null },

    // ── Audit trail ───────────────────────────────────────────────────────
    auditLog: {
      type: [auditEntrySchema],
      default: [],
      // Keep last 100 entries
    },
  },
  {
    timestamps: true,
  }
);

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

/**
 * Get the singleton settings document.
 * Creates it with defaults if it doesn't exist yet.
 * Results should be cached in Redis — see AdminSettingsService.
 */
adminSettingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne({ _key: 'singleton' });
  if (!settings) {
    settings = await this.create({ _key: 'singleton' });
  }
  return settings;
};

/**
 * Get personality by key.
 */
adminSettingsSchema.statics.getPersonality = async function (key) {
  const settings = await this.getSettings();
  return settings.personalities.find((p) => p.key === key && p.isActive) || null;
};

module.exports = mongoose.model('AdminSettings', adminSettingsSchema);
