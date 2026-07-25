'use strict';

/**
 * Subscription Model
 *
 * Manages the full lifecycle of a user's premium subscription:
 *   pending → active → expired / canceled / refunded
 *
 * Design decisions:
 *   - Separate from the Payment model. A subscription is a business entity
 *     (access rights, renewal dates) while a payment is a financial event.
 *     One subscription can have multiple payments (renewals).
 *   - currentPeriodEnd drives access control — checked on every request.
 *   - cancelAtPeriodEnd flag mirrors Stripe's model: the user keeps access
 *     until the period ends even after cancellation.
 *   - history array stores every status transition for audit purposes.
 */

const mongoose = require('mongoose');

// ---------------------------------------------------------------------------
// Sub-schema: Status history entry
// ---------------------------------------------------------------------------
const historyEntrySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    changedAt: { type: Date, default: () => new Date() },
    reason: { type: String, default: null, maxlength: 200 },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main Schema
// ---------------------------------------------------------------------------
const subscriptionSchema = new mongoose.Schema(
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

    // ── Plan details ──────────────────────────────────────────────────────
    planType: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'expired', 'canceled', 'refunded'],
      default: 'pending',
      index: true,
    },

    // ── Billing period ────────────────────────────────────────────────────
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true, index: true },

    // ── Cancellation ──────────────────────────────────────────────────────
    // User keeps access until currentPeriodEnd even after cancellation
    cancelAtPeriodEnd: { type: Boolean, default: false },
    canceledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null, maxlength: 500 },

    // ── Payment reference ─────────────────────────────────────────────────
    // Array of Payment ObjectIds — one per renewal
    paymentIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Payment',
      },
    ],
    // Stars price paid for the current period
    starsPrice: { type: Number, required: true, min: 0 },

    // ── Renewal ───────────────────────────────────────────────────────────
    autoRenew: { type: Boolean, default: false },
    // Telegram Stars doesn't support true auto-renewal — this flag signals
    // that the user should be reminded to renew before expiry.
    renewalReminderSentAt: { type: Date, default: null },
    renewalCount: { type: Number, default: 0, min: 0 },

    // ── Audit trail ───────────────────────────────────────────────────────
    history: {
      type: [historyEntrySchema],
      default: [],
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

// Renewal reminder job: active subscriptions expiring soon
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

// One active subscription per user at a time (checked in service layer)
subscriptionSchema.index({ userId: 1, status: 1 });

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

subscriptionSchema.virtual('isActive').get(function () {
  return this.status === 'active' && this.currentPeriodEnd > new Date();
});

subscriptionSchema.virtual('daysRemaining').get(function () {
  if (!this.isActive) return 0;
  const ms = this.currentPeriodEnd - new Date();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
});

// ---------------------------------------------------------------------------
// Instance methods
// ---------------------------------------------------------------------------

/** Push a status change event to the history array */
subscriptionSchema.methods.recordStatusChange = async function (
  newStatus,
  reason = null
) {
  this.history.push({ status: newStatus, reason });
  this.status = newStatus;
  await this.save();
};

/** Activate subscription after successful payment */
subscriptionSchema.methods.activate = async function (
  paymentId,
  periodStart,
  periodEnd
) {
  this.status = 'active';
  this.currentPeriodStart = periodStart;
  this.currentPeriodEnd = periodEnd;
  this.paymentIds.push(paymentId);
  this.renewalCount += 1;
  this.history.push({ status: 'active', reason: 'Payment confirmed' });
  await this.save();
};

module.exports = mongoose.model('Subscription', subscriptionSchema);
