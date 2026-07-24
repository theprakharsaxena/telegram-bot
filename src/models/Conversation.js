'use strict';

/**
 * Conversation Model
 *
 * Represents a chat session between a user and a specific AI personality.
 * One user can have multiple conversations (one per personality, or multiple
 * if they reset history). Only one conversation per user+personality is
 * "active" at a time.
 *
 * Design decisions:
 *   - Separating Conversation from Message avoids huge documents.
 *     Messages are their own collection, referencing conversationId.
 *   - summary is updated periodically by the AI to compress old context
 *     (so we don't blow up the OpenAI context window on long chats).
 *   - messageCount is a denormalised counter — avoids a COUNT(*) query
 *     every time we need to display chat stats.
 */

const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
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
      // Denormalised for fast lookup without joining User
    },

    // ── Personality ────────────────────────────────────────────────────────
    personality: {
      type: String,
      required: true,
      default: 'luna',
      maxlength: 32,
      index: true,
    },

    // ── Status ────────────────────────────────────────────────────────────
    isActive: {
      type: Boolean,
      default: true,
      index: true,
      // Only one active conversation per user+personality at a time
      // (enforced by the service layer, not a DB constraint)
    },

    // ── Context summary ───────────────────────────────────────────────────
    // When message count grows large, the AI summarises old messages into
    // this field. The summary is prepended to the context window instead of
    // sending all raw messages, keeping token usage predictable.
    summary: {
      type: String,
      default: null,
      maxlength: 4000,
    },
    lastSummarisedAt: {
      type: Date,
      default: null,
    },
    // How many messages were included in the last summary
    summarisedUpToMessageIndex: {
      type: Number,
      default: 0,
    },

    // ── Counters (denormalised) ────────────────────────────────────────────
    messageCount: { type: Number, default: 0, min: 0 },
    userMessageCount: { type: Number, default: 0, min: 0 },

    // ── Metadata ──────────────────────────────────────────────────────────
    title: {
      type: String,
      default: null,
      maxlength: 120,
      // Auto-generated from first message in the service layer
    },
    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastMessagePreview: {
      type: String,
      default: null,
      maxlength: 200,
      // Snippet of last message for conversation list display
    },
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

// The most common query: "get the active conversation for this user + personality"
conversationSchema.index({ telegramId: 1, personality: 1, isActive: 1 });

// Admin: list all conversations sorted by recency
conversationSchema.index({ lastMessageAt: -1 });

// ---------------------------------------------------------------------------
// Instance methods
// ---------------------------------------------------------------------------

/** Mark conversation as inactive (soft close, preserves history) */
conversationSchema.methods.close = async function () {
  this.isActive = false;
  await this.save();
};

/** Increment message counters — called after every new message is saved */
conversationSchema.methods.incrementCounters = async function (role) {
  this.messageCount += 1;
  if (role === 'user') this.userMessageCount += 1;
  await this.save();
};

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

/**
 * Get or create the active conversation for a user + personality combo.
 * This is the primary entry point used by the message handler.
 */
conversationSchema.statics.getOrCreate = async function (userId, telegramId, personality) {
  let conversation = await this.findOne({
    telegramId,
    personality,
    isActive: true,
  });

  if (!conversation) {
    conversation = await this.create({
      userId,
      telegramId,
      personality,
      isActive: true,
    });
  }

  return conversation;
};

module.exports = mongoose.model('Conversation', conversationSchema);
