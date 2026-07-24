'use strict';

/**
 * Memory Model
 *
 * Stores extracted long-term facts about the user that the AI should
 * "remember" across all conversations. Examples:
 *   - "User's name is Alex"
 *   - "User has a dog named Max"
 *   - "User's birthday is March 15"
 *   - "User works as a software engineer"
 *
 * How it works:
 *   After every N messages, the AI service extracts key facts from the
 *   conversation and upserts them here. These memories are prepended to
 *   every system prompt so the AI feels like it genuinely knows the user.
 *
 * Design decisions:
 *   - category groups memories for selective injection (we might only inject
 *     'personal' facts into casual conversations, not all categories)
 *   - importance score (0-1) lets us prioritise which memories to include
 *     when the user hits the free plan memory limit
 *   - source tracks which conversation the memory came from for audit/debug
 *   - TTL index on expiresAt allows ephemeral memories (e.g. "User is on
 *     vacation this week") that auto-delete after a date
 */

const mongoose = require('mongoose');

const memorySchema = new mongoose.Schema(
  {
    // ── Relationships ──────────────────────────────────────────────────────
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    telegramId: {
      type: Number,
      required: true,
      index: true,
    },
    // Which conversation produced this memory
    sourceConversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },

    // ── Memory content ────────────────────────────────────────────────────
    // Short factual statement in third-person present tense
    // e.g. "The user's name is Alex and they live in New York."
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },

    // Category for selective injection and UI grouping
    category: {
      type: String,
      enum: [
        'personal',      // name, age, location, relationships
        'preferences',   // likes, dislikes, hobbies
        'professional',  // job, education, skills
        'emotional',     // mood patterns, support needs
        'temporal',      // time-sensitive facts (vacation, event)
        'other',
      ],
      default: 'personal',
      index: true,
    },

    // ── Scoring ───────────────────────────────────────────────────────────
    // 0.0 = trivial, 1.0 = critical to personalisation
    // Used when pruning memories at the free plan limit
    importance: {
      type: Number,
      default: 0.5,
      min: 0,
      max: 1,
    },

    // ── Deduplication key ────────────────────────────────────────────────
    // Normalised hash of the content — prevents storing the same fact twice.
    // Computed by the memory service before insert.
    contentHash: {
      type: String,
      maxlength: 64,
      default: null,
    },

    // ── Confidence ────────────────────────────────────────────────────────
    // How confident the AI was when extracting this memory (0-1)
    confidence: {
      type: Number,
      default: 1.0,
      min: 0,
      max: 1,
    },

    // ── Lifecycle ─────────────────────────────────────────────────────────
    isActive: { type: Boolean, default: true, index: true },
    // MongoDB TTL — set a future date to auto-expire ephemeral memories
    expiresAt: {
      type: Date,
      default: null,
    },

    // How many times this memory has been injected into a prompt
    usageCount: { type: Number, default: 0, min: 0 },
    lastUsedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Primary query: active memories for a user, sorted by importance
memorySchema.index({ userId: 1, isActive: 1, importance: -1 });

// Deduplication check before inserting new memory
memorySchema.index({ userId: 1, contentHash: 1 }, { sparse: true });

// TTL index — MongoDB deletes documents when expiresAt is in the past
memorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

/**
 * Get active memories for a user, respecting plan limits.
 * Returns highest-importance memories first.
 * @param {ObjectId} userId
 * @param {number} limit — max memories to return (from plan config)
 */
memorySchema.statics.getForUser = function (userId, limit = 20) {
  return this.find({ userId, isActive: true })
    .sort({ importance: -1, createdAt: -1 })
    .limit(limit)
    .select('content category importance')
    .lean();
};

/**
 * Upsert a memory — if a memory with the same contentHash already exists,
 * update its importance and lastUsedAt instead of creating a duplicate.
 */
memorySchema.statics.upsertMemory = async function (data) {
  if (data.contentHash) {
    return this.findOneAndUpdate(
      { userId: data.userId, contentHash: data.contentHash },
      {
        $set: {
          importance: data.importance,
          confidence: data.confidence,
          lastUsedAt: new Date(),
        },
        $inc: { usageCount: 1 },
        $setOnInsert: {
          ...data,
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  return this.create(data);
};

module.exports = mongoose.model('Memory', memorySchema);
