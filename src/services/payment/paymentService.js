'use strict';

/**
 * PaymentService
 *
 * Manages the full Telegram Stars payment lifecycle:
 *
 *   createInvoice()         → generate Payment record + send Telegram invoice
 *   handlePreCheckout()     → validate payload, approve or reject
 *   handleSuccessfulPayment()→ create/renew Subscription, upgrade User.plan
 *   getActiveSubscription() → read current sub for a user
 *   cancelSubscription()    → flag cancelAtPeriodEnd = true
 *
 * Telegram Stars currency code: XTR
 * provider_token must be empty string "" for Stars payments.
 *
 * Invoice payload format: "plan_<weekly|monthly>_<userId>_<timestamp>"
 * This makes it globally unique and embeds context for verification.
 */

const { v4: uuidv4 }  = require('uuid');
const { User, Payment, Subscription, Analytics } = require('../../models');
const { sendInvoice, sendMessage }               = require('../bot/telegramService');
const config    = require('../../config/env');
const logger    = require('../../utils/logger');
const AppError  = require('../../utils/AppError');

// Plan definitions — prices come from AdminSettings at runtime
const PLAN_DURATIONS = {
  daily:   1,   // days
  weekly:  7,   // days
  monthly: 30,  // days
};

// ---------------------------------------------------------------------------
// Create invoice
// ---------------------------------------------------------------------------

/**
 * Send a Telegram Stars invoice to the user for the chosen plan.
 * Creates a pending Payment record first so we can match it on callback.
 *
 * @param {object} user       — User document
 * @param {string} planType   — 'weekly' | 'monthly'
 * @param {object} settings   — AdminSettings (for runtime pricing)
 */
async function createInvoice(user, planType, settings) {
  if (!['daily', 'weekly', 'monthly'].includes(planType)) {
    throw new AppError('Invalid plan type', 400);
  }

  let starsPrice;
  if (planType === 'daily') {
    starsPrice = settings?.starsDailyPrice ?? config.stars.dailyPrice;
  } else if (planType === 'weekly') {
    starsPrice = settings?.starsWeeklyPrice ?? config.stars.weeklyPrice;
  } else {
    starsPrice = settings?.starsMonthlyPrice ?? config.stars.monthlyPrice;
  }

  // Unique payload — used to match this payment in pre_checkout + successful_payment
  const payload = `plan_${planType}_${user._id}_${Date.now()}`;

  // Create pending payment record BEFORE sending invoice
  // (if Telegram call fails we don't have an orphaned record — we just don't send)
  const payment = await Payment.create({
    userId:         user._id,
    telegramId:     user.telegramId,
    invoicePayload: payload,
    planType,
    starsAmount:    starsPrice,
    status:         'pending',
  });

  const planLabel  = planType === 'daily' ? 'Daily' : (planType === 'weekly' ? 'Weekly' : 'Monthly');
  const days       = PLAN_DURATIONS[planType];

  try {
    await sendInvoice(user.telegramId, {
      title:       `${config.bot.name} Premium — ${planLabel}`,
      description:
        `${days} days of unlimited conversations, ${config.limits.premium.dailyImages} images/day, ` +
        `long-term memory, and exclusive personalities.`,
      payload,
      prices: [{ label: `${planLabel} Premium`, amount: starsPrice }],
      options: {},
    });

    logger.info('Invoice sent', {
      telegramId: user.telegramId,
      planType,
      starsPrice,
      paymentId: payment._id,
    });

    return payment;
  } catch (err) {
    // Clean up the pending record if the send failed
    await Payment.findByIdAndDelete(payment._id);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Pre-checkout validation
// ---------------------------------------------------------------------------

/**
 * Validate a pre_checkout_query before approving it.
 * Telegram requires a response within 10 seconds.
 *
 * @returns {{ ok: boolean, errorMessage: string|null }}
 */
async function handlePreCheckout(preCheckoutQuery) {
  const { id: queryId, invoice_payload: payload, from, total_amount } = preCheckoutQuery;

  try {
    // Find the matching pending payment
    const payment = await Payment.findByPayload(payload);

    if (!payment) {
      logger.warn('Pre-checkout: no matching payment found', { payload, queryId });
      return { ok: false, errorMessage: 'Invalid payment session. Please try again.' };
    }

    // Verify the buyer matches the invoice creator
    if (payment.telegramId !== from.id) {
      logger.warn('Pre-checkout: telegramId mismatch', {
        expected: payment.telegramId,
        got:      from.id,
      });
      return { ok: false, errorMessage: 'Payment session mismatch. Please try again.' };
    }

    // Mark as pre_checkout
    payment.status             = 'pre_checkout';
    payment.preCheckoutQueryId = queryId;
    payment.preCheckoutAt      = new Date();
    await payment.save();

    logger.info('Pre-checkout approved', {
      telegramId: from.id,
      payload,
      starsAmount: total_amount,
    });

    return { ok: true, errorMessage: null };

  } catch (err) {
    logger.error('Pre-checkout error', { error: err.message, payload });
    return { ok: false, errorMessage: 'Internal error. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// Successful payment handler
// ---------------------------------------------------------------------------

/**
 * Process a confirmed Telegram Stars payment.
 * Activates or renews the user's premium subscription.
 *
 * @param {object} msg — Telegram message containing successful_payment
 */
async function handleSuccessfulPayment(msg) {
  const { successful_payment: sp, from } = msg;
  const {
    invoice_payload:              payload,
    telegram_payment_charge_id:   telegramChargeId,
    provider_payment_charge_id:   providerChargeId,
    total_amount:                 starsAmount,
  } = sp;

  logger.info('Processing successful payment', {
    telegramId: from.id,
    payload,
    telegramChargeId,
    starsAmount,
  });

  try {
    // Find the matching payment record
    const payment = await Payment.findByPayload(payload);
    if (!payment) {
      logger.error('Successful payment: no matching record', { payload, telegramChargeId });
      return;
    }

    // Mark payment as completed
    payment.status                  = 'completed';
    payment.telegramChargeId        = telegramChargeId;
    payment.providerPaymentChargeId = providerChargeId || null;
    payment.completedAt             = new Date();
    await payment.save();

    // Calculate subscription period
    const now         = new Date();
    const days        = PLAN_DURATIONS[payment.planType] || 30;
    const periodEnd   = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Find existing subscription or create new one
    let subscription = await Subscription.findOne({
      userId: payment.userId,
      status: { $in: ['active', 'pending'] },
    });

    if (subscription) {
      // Renewal — extend from current end date if still active
      const baseDate = subscription.status === 'active' && subscription.currentPeriodEnd > now
        ? subscription.currentPeriodEnd
        : now;
      const newEnd = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
      await subscription.activate(payment._id, now, newEnd);
      subscription.renewalCount += 1;
      await subscription.save();
    } else {
      // New subscription
      subscription = await Subscription.create({
        userId:             payment.userId,
        telegramId:         from.id,
        planType:           payment.planType,
        status:             'active',
        currentPeriodStart: now,
        currentPeriodEnd:   periodEnd,
        paymentIds:         [payment._id],
        starsPrice:         starsAmount,
        renewalCount:       1,
        history: [{ status: 'active', reason: 'Initial purchase' }],
      });
    }

    // Link subscription to payment
    payment.subscriptionId = subscription._id;
    await payment.save();

    // Upgrade user plan
    await User.findByIdAndUpdate(payment.userId, {
      $set: {
        plan:          'premium',
        planExpiresAt: subscription.currentPeriodEnd,
      },
    });

    // Invalidate usage limits cache
    const { redisClient } = require('../../config/redis');
    await redisClient.del('limits:config').catch(() => {});

    // Update analytics (fire-and-forget)
    const today = new Date().toISOString().slice(0, 10);
    Analytics.increment(today, {
      paymentsCompleted:       1,
      totalStarsEarned:        starsAmount,
      [`${payment.planType}SubscriptionsSold`]: 1,
    }).catch(() => {});

    // Notify user
    const planLabel  = payment.planType === 'daily' ? 'Daily' : (payment.planType === 'weekly' ? 'Weekly' : 'Monthly');
    const expiryDate = subscription.currentPeriodEnd.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    await sendMessage(
      from.id,
      `⭐ <b>Welcome to Premium!</b>\n\n` +
      `You're now on the <b>${planLabel} Premium</b> plan.\n` +
      `Your subscription is active until <b>${expiryDate}</b>.\n\n` +
      `✨ What you've unlocked:\n` +
      `💬 ${config.limits.premium.dailyMessages} messages/day\n` +
      `🖼️ ${config.limits.premium.dailyImages} images/day\n` +
      `🧠 ${config.limits.premium.memoryLimit} long-term memories\n` +
      `🔒 Exclusive personalities\n\n` +
      `Enjoy the full ${config.bot.name} experience! 💖`
    );

    logger.info('Premium activated', {
      telegramId:     from.id,
      planType:       payment.planType,
      expiresAt:      subscription.currentPeriodEnd,
      subscriptionId: subscription._id,
    });

  } catch (err) {
    logger.error('handleSuccessfulPayment error', {
      error:   err.message,
      payload,
      stack:   err.stack,
    });
  }
}

// ---------------------------------------------------------------------------
// Subscription management
// ---------------------------------------------------------------------------

/**
 * Get the active subscription for a user.
 */
async function getActiveSubscription(userId) {
  return Subscription.findOne({
    userId,
    status:            'active',
    currentPeriodEnd:  { $gt: new Date() },
  }).lean();
}

/**
 * Cancel a subscription at period end.
 * User keeps access until currentPeriodEnd.
 */
async function cancelSubscription(userId, reason = 'User requested cancellation') {
  const sub = await Subscription.findOne({ userId, status: 'active' });
  if (!sub) throw new AppError('No active subscription found', 404);

  sub.cancelAtPeriodEnd = true;
  sub.canceledAt        = new Date();
  sub.cancellationReason = reason;
  sub.history.push({ status: 'canceled', reason });
  await sub.save();

  logger.info('Subscription cancellation scheduled', {
    userId,
    expiresAt: sub.currentPeriodEnd,
  });

  return sub;
}

module.exports = {
  createInvoice,
  handlePreCheckout,
  handleSuccessfulPayment,
  getActiveSubscription,
  cancelSubscription,
};
