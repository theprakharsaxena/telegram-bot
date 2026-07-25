'use strict';

/**
 * /premium Command Handler
 *
 * Shows the user's current plan status and available upgrade options.
 * For free users: displays pricing and buy buttons.
 * For premium users: shows subscription details and cancellation option.
 */

const { sendMessage }        = require('../../services/bot/telegramService');
const { getActiveSubscription } = require('../../services/payment/paymentService');
const { AdminSettings }      = require('../../models');
const config                 = require('../../config/env');

async function premiumCommand(msg) {
  const { user, chatId } = msg._ctx;
  const isPremium = user.isPremium;

  const settings      = await AdminSettings.getSettings();
  const dailyPrice    = settings.starsDailyPrice    ?? config.stars.dailyPrice;
  const weeklyPrice   = settings.starsWeeklyPrice   ?? config.stars.weeklyPrice;
  const monthlyPrice  = settings.starsMonthlyPrice  ?? config.stars.monthlyPrice;

  // ── Already premium ────────────────────────────────────────────────────
  if (isPremium) {
    const sub        = await getActiveSubscription(user._id);
    const expiryDate = user.planExpiresAt
      ? new Date(user.planExpiresAt).toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric',
        })
      : 'Never';
    const daysLeft   = sub
      ? Math.max(0, Math.ceil(
          (new Date(sub.currentPeriodEnd) - Date.now()) / (1000 * 60 * 60 * 24)
        ))
      : 0;

    let planText = 'Monthly';
    if (sub?.planType === 'daily') planText = 'Daily';
    else if (sub?.planType === 'weekly') planText = 'Weekly';

    await sendMessage(
      chatId,
      `⭐ <b>Your Premium Membership</b>\n\n` +
      `Status: <b>Active ✅</b>\n` +
      `Plan: <b>${planText}</b>\n` +
      `Expires: <b>${expiryDate}</b> (${daysLeft} day${daysLeft !== 1 ? 's' : ''} left)\n\n` +
      `<b>Your benefits:</b>\n` +
      `💬 Unlimited chat\n` +
      `🖼️ ${config.limits.premium.dailyImages} images/day\n` +
      `🧠 ${config.limits.premium.memoryLimit} long-term memories\n` +
      `🔒 All exclusive personalities\n\n` +
      `Want to renew early or switch plans? Tap below:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: `🔄 Renew Daily — ${dailyPrice} ⭐`,   callback_data: 'payment:daily' },
              { text: `🔄 Renew Weekly — ${weeklyPrice} ⭐`,   callback_data: 'payment:weekly' },
            ],
            [
              { text: `🔄 Renew Monthly — ${monthlyPrice} ⭐`, callback_data: 'payment:monthly' },
            ],
            [{ text: '❌ Cancel subscription', callback_data: 'payment:cancel_confirm' }],
          ],
        },
      }
    );
    return;
  }

  // ── Free user — show upgrade options ──────────────────────────────────
  await sendMessage(
    chatId,
    `⭐ <b>Upgrade to Premium</b>\n\n` +
    `Unlock the full ${config.bot.name} experience:\n\n` +
    `💬 <b>Unlimited chat</b> (vs ${config.limits.free.dailyMessages} free/day)\n` +
    `🖼️ <b>${config.limits.premium.dailyImages} images/day</b> (vs ${config.limits.free.dailyImages} free/day)\n` +
    `🧠 <b>${config.limits.premium.memoryLimit} long-term memories</b>\n` +
    `✨ <b>All personalities</b> including exclusive ones\n` +
    `⚡ <b>Priority responses</b>\n\n` +
    `<b>Choose your plan:</b>`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `⚡ 1 Day — ${dailyPrice} ⭐`,
              callback_data: 'payment:daily',
            },
          ],
          [
            {
              text: `📅 7 Days — ${weeklyPrice} ⭐`,
              callback_data: 'payment:weekly',
            },
          ],
          [
            {
              text: `🗓️ 30 Days — ${monthlyPrice} ⭐`,
              callback_data: 'payment:monthly',
            },
          ],
          [{ text: '❓ What are Telegram Stars?', callback_data: 'payment:stars_info' }],
        ],
      },
    }
  );
}

module.exports = { premiumCommand };
