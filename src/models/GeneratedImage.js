'use strict';

/**
 * GeneratedImage Model
 *
 * Tracks every AI-generated image: the prompt used, the model, the output URL,
 * whether it was delivered to the user, and which message triggered it.
 *
 * Design decisions:
 *   - We store the Replicate prediction ID so we can poll for async results
 *     and re-fetch if the webhook delivery fails.
 *   - imageUrl stores the Replicate CDN URL. In production you should
 *     download and re-host on S3 for permanence (Replicate URLs expire).
 *     That migration happens in Phase 8; the field is ready for it.
 *   - status mirrors Replicate's prediction lifecycle so the job worker
 *     knows what to do with each record.
 */

const mongoose = require('mongoose');

const generatedImageSchema = new mongoose.Schema(
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
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      default: null,
    },
    // The message that triggered this generation
    triggerMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },

    // ── Prompt ────────────────────────────────────────────────────────────
    // The raw user request ("send me a selfie")
    userPrompt: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    // The enhanced prompt sent to Replicate (after personality/style injection)
    enhancedPrompt: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    negativePrompt: {
      type: String,
      default: '',
      maxlength: 1000,
    },

    // ── Generation config ─────────────────────────────────────────────────
    model: {
      type: String,
      required: true,
      maxlength: 200,
    },
    width: { type: Number, default: 1024 },
    height: { type: Number, default: 1024 },
    steps: { type: Number, default: 30 },
    guidanceScale: { type: Number, default: 7.5 },
    seed: { type: Number, default: null },

    // ── Replicate tracking ────────────────────────────────────────────────
    replicatePredictionId: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },

    // ── Output ────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'processing', 'succeeded', 'failed', 'canceled'],
      default: 'pending',
      index: true,
    },
    imageUrl: {
      type: String,
      default: null,
      maxlength: 1000,
    },
    // Telegram file_id after successfully sending to user
    // (cheaper to re-send by file_id than re-upload)
    telegramFileId: {
      type: String,
      default: null,
    },

    // ── Timing ────────────────────────────────────────────────────────────
    generationStartedAt: { type: Date, default: null },
    generationCompletedAt: { type: Date, default: null },
    // Duration in milliseconds
    generationDurationMs: { type: Number, default: null },

    // ── Error handling ────────────────────────────────────────────────────
    errorMessage: { type: String, default: null, maxlength: 500 },
    retryCount: { type: Number, default: 0, min: 0 },

    // ── Plan context ──────────────────────────────────────────────────────
    // Track which plan the user was on — useful for analytics
    userPlan: {
      type: String,
      enum: ['free', 'premium'],
      required: true,
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

// Daily image count query (used by usage limits)
generatedImageSchema.index({ telegramId: 1, createdAt: -1 });

// Admin: recent generations across all users
generatedImageSchema.index({ createdAt: -1, status: 1 });

// Job worker: find pending/processing items to retry
generatedImageSchema.index({ status: 1, createdAt: 1 });

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

generatedImageSchema.virtual('isComplete').get(function () {
  return this.status === 'succeeded';
});

generatedImageSchema.virtual('isFailed').get(function () {
  return this.status === 'failed' || this.status === 'canceled';
});

module.exports = mongoose.model('GeneratedImage', generatedImageSchema);
