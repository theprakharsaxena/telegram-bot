'use strict';

/**
 * Payment Model
 *
 * Immutable ledger of every Telegram Stars transaction.
 * Never modified after creation — status changes are additive (new fields set,
 * nothing overwritten) so the record is always auditable.
 *
 * Telegram Stars payment flow:
 *   1. Bot sends invoice (invoicePayload stored here as reference)
 *   2. User pays → Telegram sends pre_checkout_query → bot answers OK
 *   3. Telegram sends successful_payment → we record telegramChargeId
 *   4. We activate the subscription
 *
 * Design decisions:
 *   - telegramChargeId is Telegram's unique payment reference.
 *     Used for refund requests and dispute resolution.
 *   - providerPaymentChargeId is the payment processor's ID
 *     (behind Telegram Stars infrastructure).
 *   - status transitions: pending → completed | failed | refunded
 */

const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
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
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
    },

    // ── Invoice ───────────────────────────────────────────────────────────
    // Unique payload we generate for the invoice — used to match
    // the successful_payment callback back to this record
    invoicePayload: {
      type: String,
      required: true,
      unique: true,
      maxlength: 128,
    },
    planType: {
      type: String,
      enum: ['weekly', 'monthly'],
      required: true,
    },
    // Amount in Telegram Stars
    starsAmount: {
      type: Number,
      required: true,
      min: 1,
    },

    // ── Status ────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'pre_checkout', 'completed', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },

    // ── Telegram references ────────────────────────────────────────────────
    // Set when pre_checkout_query is received
    preCheckoutQueryId: { type: String, default: null },
    // Set when successful_payment is received — this is the receipt ID
    telegramChargeId: {
      type: String,
      default: null,
      index: true,
      sparse: true,
    },
    providerPaymentChargeId: { type: String, default: null },

    // ── Timing ────────────────────────────────────────────────────────────
    invoiceCreatedAt: { type: Date, default: () => new Date() },
    preCheckoutAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },

    // ── Error / notes ─────────────────────────────────────────────────────
    failureReason: { type: String, default: null, maxlength: 500 },
    adminNotes: { type: String, default: null, maxlength: 1000 },
  },
  {
    timestamps: true,
    // Prevent accidental updates — payments should be append-only
    // (enforced at service layer; schema itself is mutable for status updates)
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Revenue dashboard: payments over time
paymentSchema.index({ createdAt: -1, status: 1 });

// Admin: payments per user
paymentSchema.index({ userId: 1, createdAt: -1 });

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

/**
 * Find a pending payment by its invoice payload.
 * Used in the pre_checkout_query handler to validate before approving.
 */
paymentSchema.statics.findByPayload = function (invoicePayload) {
  return this.findOne({ invoicePayload, status: { $in: ['pending', 'pre_checkout'] } });
};

/**
 * Get total stars revenue in a date range (for admin dashboard).
 */
paymentSchema.statics.getTotalRevenue = function (startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        status: 'completed',
        completedAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: null,
        totalStars: { $sum: '$starsAmount' },
        count: { $sum: 1 },
      },
    },
  ]);
};

module.exports = mongoose.model('Payment', paymentSchema);
