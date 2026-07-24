'use strict';

/**
 * Subscription Expiry & Renewal Reminder Job
 *
 * Runs on a schedule (every hour via setInterval on boot).
 * Does three things:
 *
 *   1. Expire subscriptions past their currentPeriodEnd
 *      → set status = 'expired', downgrade user.plan to 'free'
 *
 *   2. Send renewal reminders
 *      → 3 days before expiry, once per subscription period
 *
 *   3. Roll up daily analytics
 *      → once at midnight UTC
 *
 * Why setInterval instead of BullMQ?
 *   BullMQ repeat jobs require a scheduler process, which adds complexity.
 *   For infrequent jobs (hourly) setInterval is simpler and reliable.
 *   The job is idempotent — running it twice causes no harm.
 */

const { User, Subscription, Analytics, UsageTracking } = require('../models');
const { sendMessage } = require('../services/bot/telegramService');
const config          = require('../config/env');
const logger          = require('../utils/logger');

const REMINDER_DAYS_BEFORE = 3; // send reminder this many days before expiry
const JOB_INTERVAL_MS      = 60 * 60 * 1000; // run every hour

// Track last daily rollup to avoid running it multiple times
let lastRollupDate = '';

// ---------------------------------------------------------------------------
// Expiry check
// ---------------------------------------------------------------------------

async function expireSubscriptions() {
  const now      = new Date();
  const expired  = await Subscription.find({
    status:           'active',
    currentPeriodEnd: { $lt: now },
  }).limit(100);

  if (!expired.length) return;

  logger.info(`Expiring ${expired.length} subscription(s)`);

  for (const sub of expired) {
    try {
      // Update subscription status
      sub.status = 'expired';
      sub.history.push({ status: 'expired', reason: 'Period ended' });
      await sub.save();

      // Downgrade user
      await User.findByIdAndUpdate(sub.userId, {
        $set: { plan: 'free', planExpiresAt: null },
      });

      // Notify user
      await sendMessage(
        sub.telegramId,
        `⏰ <b>Your Premium has expired.</b>\n\n` +
        `Your subscription ended and you're now on the free plan.\n\n` +
        `💬 You have ${config.limits.free.dailyMessages} messages/day\n` +
        `🖼️ ${config.limits.free.dailyImages} images/day\n\n` +
        `Renew anytime with /premium to get back unlimited access! ⭐`
      ).catch(() => {}); // don't crash if user blocked the bot

      logger.info('Subscription expired', {
        subscriptionId: sub._id,
        telegramId:     sub.telegramId,
      });

      // Update today's analytics
      const today = new Date().toISOString().slice(0, 10);
      Analytics.increment(today, { subscriptionsExpired: 1 }).catch(() => {});

    } catch (err) {
      logger.error('Error expiring subscription', {
        subscriptionId: sub._id,
        error: err.message,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Renewal reminders
// ---------------------------------------------------------------------------

async function sendRenewalReminders() {
  const now         = new Date();
  const reminderCutoff = new Date(now.getTime() + REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000);

  const subs = await Subscription.find({
    status:                 'active',
    currentPeriodEnd:       { $gt: now, $lt: reminderCutoff },
    renewalReminderSentAt:  null,   // only send once
    cancelAtPeriodEnd:      false,  // don't remind users who already cancelled
  }).limit(50);

  if (!subs.length) return;

  logger.info(`Sending renewal reminders to ${subs.length} user(s)`);

  for (const sub of subs) {
    try {
      const daysLeft   = Math.ceil((sub.currentPeriodEnd - now) / (1000 * 60 * 60 * 24));
      const expiryDate = sub.currentPeriodEnd.toLocaleDateString('en-US', {
        month: 'long', day: 'numeric',
      });

      await sendMessage(
        sub.telegramId,
        `⭐ <b>Premium Renewal Reminder</b>\n\n` +
        `Your premium subscription expires in <b>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</b> (${expiryDate}).\n\n` +
        `Tap /premium to renew and keep your unlimited access! 💖`
      ).catch(() => {});

      // Mark reminder as sent
      sub.renewalReminderSentAt = now;
      await sub.save();

      logger.info('Renewal reminder sent', {
        telegramId: sub.telegramId,
        daysLeft,
      });
    } catch (err) {
      logger.error('Error sending renewal reminder', {
        subscriptionId: sub._id,
        error: err.message,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Daily analytics rollup
// ---------------------------------------------------------------------------

async function rollupDailyAnalytics() {
  const today = new Date().toISOString().slice(0, 10);

  // Only run once per day
  if (lastRollupDate === today) return;

  // Check it's past midnight UTC (run between 00:00 and 01:00 UTC)
  const hour = new Date().getUTCHours();
  if (hour !== 0) return;

  lastRollupDate = today;

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  try {
    logger.info('Running daily analytics rollup', { date: yesterdayStr });

    // Aggregate yesterday's usage
    const usageAgg = await UsageTracking.aggregate([
      { $match: { date: yesterdayStr } },
      {
        $group: {
          _id:           null,
          totalMessages: { $sum: '$messagesUsed' },
          totalImages:   { $sum: '$imagesUsed' },
          activeUsers:   { $sum: { $cond: [{ $gt: ['$messagesUsed', 0] }, 1, 0] } },
          limitHits:     { $sum: {
            $cond: [{ $gte: ['$messagesUsed', '$messageLimit'] }, 1, 0]
          }},
        },
      },
    ]);

    const usage = usageAgg[0] || {};

    // Total user counts
    const [totalUsers, premiumUsers] = await Promise.all([
      User.countDocuments({ isDeleted: false }),
      User.countDocuments({ plan: 'premium', isDeleted: false }),
    ]);

    await Analytics.findOneAndUpdate(
      { date: yesterdayStr },
      {
        $set: {
          totalUsers,
          premiumUsers,
          activeUsers:       usage.activeUsers    || 0,
          totalMessages:     usage.totalMessages  || 0,
          userMessages:      usage.totalMessages  || 0,
          totalImagesGenerated: usage.totalImages || 0,
          messageLimitHits:  usage.limitHits      || 0,
        },
      },
      { upsert: true }
    );

    logger.info('Daily analytics rollup complete', { date: yesterdayStr });
  } catch (err) {
    logger.error('Analytics rollup failed', { error: err.message });
    lastRollupDate = ''; // allow retry
  }
}

// ---------------------------------------------------------------------------
// Main job runner
// ---------------------------------------------------------------------------

async function runSubscriptionJob() {
  logger.info('Subscription job running');
  try {
    await expireSubscriptions();
    await sendRenewalReminders();
    await rollupDailyAnalytics();
  } catch (err) {
    logger.error('Subscription job error', { error: err.message });
  }
}

/**
 * Start the subscription job on a recurring schedule.
 * Call this once during server startup.
 */
function startSubscriptionJob() {
  // Run immediately on start, then every hour
  runSubscriptionJob();
  const timer = setInterval(runSubscriptionJob, JOB_INTERVAL_MS);
  // Allow Node to exit even if this timer is pending
  timer.unref();
  logger.info('Subscription job scheduled (hourly)');
  return timer;
}

module.exports = { startSubscriptionJob, runSubscriptionJob };
