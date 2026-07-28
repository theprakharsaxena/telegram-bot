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
      `🖼️ ${config.limits.premium.dailyImages} uncensored 🔞 images/day\n` +
      `🧠 ${config.limits.premium.memoryLimit} long-term memories\n` +
      `🔒 Access to all girlfriends including exclusive VIP companions\n\n` +
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
  const dailyPriceRate = dailyPrice;
  const weeklyPriceRate = weeklyPrice / 7;
  const monthlyPriceRate = monthlyPrice / 30;

  const weeklySavings = dailyPriceRate > 0
    ? Math.round((1 - weeklyPriceRate / dailyPriceRate) * 100)
    : 0;

  const monthlySavings = dailyPriceRate > 0
    ? Math.round((1 - monthlyPriceRate / dailyPriceRate) * 100)
    : 0;

  // Build inline keyboard
  const inlineKeyboard = [
    [
      {
        text: `⚡ 1 Day VIP Access — ${dailyPrice} ⭐`,
        callback_data: 'payment:daily',
      },
    ],
    [
      {
        text: `📅 7 Days VIP Access — ${weeklyPrice} ⭐ ${weeklySavings > 0 ? `(save ${weeklySavings}%)` : ''}`,
        callback_data: 'payment:weekly',
      },
    ],
    [
      {
        text: `🗓️ 30 Days VIP Access — ${monthlyPrice} ⭐ ${monthlySavings > 0 ? `(save ${monthlySavings}%)` : ''}`,
        callback_data: 'payment:monthly',
      },
    ],
    [{ text: '❓ What are Telegram Stars?', callback_data: 'payment:stars_info' }],
  ];

  // Add "Watch Ad" button if Adsgram is enabled
  if (config.adsgram.enabled) {
    inlineKeyboard.splice(3, 0, [
      {
        text: `🎬 Watch Ad — +${config.adsgram.bonusMessages} msgs & +${config.adsgram.bonusImages} images`,
        callback_data: 'adsgram:watch',
      },
    ]);
  }

  await sendMessage(
    chatId,
    `🔥 <b>Get VIP Premium Pass</b> 🔥\n\n` +
    `Unlock the absolute ultimate experience with your girlfriends:\n\n` +
    `💬 <b>Unlimited dirty chat & roleplay</b> 💋\n` +
    `🖼️ <b>30 Uncensored 🔞 images per day</b> (vs 3 free/day)\n` +
    `🧠 <b>Deep memory tracking</b> — she remembers your desires!\n` +
    `✨ <b>Unlock all hot & exclusive girlfriends</b> 👙\n` +
    `⚡ <b>Priority instant responses</b> — zero delays!\n\n` +
    `<b>Choose your VIP plan:</b>` +
    (config.adsgram.enabled
      ? `\n\n💡 <b>Or watch a short ad to get bonus credits!</b>`
      : ''),
    {
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    }
  );
}

module.exports = { premiumCommand };
