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

    await sendMessage(
      chatId,
      `⭐ <b>Your Premium Membership</b>\n\n` +
      `Status: <b>Active ✅</b>\n` +
      `Plan: <b>${sub?.planType === 'weekly' ? 'Weekly' : 'Monthly'}</b>\n` +
      `Expires: <b>${expiryDate}</b> (${daysLeft} day${daysLeft !== 1 ? 's' : ''} left)\n\n` +
      `<b>Your benefits:</b>\n` +
      `💬 ${config.limits.premium.dailyMessages} messages/day\n` +
      `🖼️ ${config.limits.premium.dailyImages} images/day\n` +
      `🧠 ${config.limits.premium.memoryLimit} long-term memories\n` +
      `🔒 All exclusive personalities\n\n` +
      `Want to renew early or switch plans? Tap below:`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: `🔄 Renew Weekly — ${weeklyPrice} ⭐`,   callback_data: 'payment:weekly' },
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
  const savingsPct = monthlyPrice > 0
    ? Math.round((1 - monthlyPrice / (weeklyPrice * 4)) * 100)
    : 0;

  await sendMessage(
    chatId,
    `⭐ <b>Upgrade to Premium</b>\n\n` +
    `Unlock the full ${config.bot.name} experience:\n\n` +
    `💬 <b>${config.limits.premium.dailyMessages} messages/day</b> (vs ${config.limits.free.dailyMessages} free)\n` +
    `🖼️ <b>${config.limits.premium.dailyImages} images/day</b> (vs ${config.limits.free.dailyImages} free)\n` +
    `🧠 <b>${config.limits.premium.memoryLimit} long-term memories</b>\n` +
    `✨ <b>All personalities</b> including exclusive ones\n` +
    `⚡ <b>Priority responses</b>\n\n` +
    `<b>Choose your plan:</b>`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `📅 Weekly — ${weeklyPrice} ⭐`,
              callback_data: 'payment:weekly',
            },
          ],
          [
            {
              text: `🗓️ Monthly — ${monthlyPrice} ⭐  ${savingsPct > 0 ? `(save ${savingsPct}%)` : ''}`,
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
