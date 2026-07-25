'use strict';

/**
 * /profile Command Handler
 *
 * Shows the user's profile card:
 *   - Display name, plan, join date
 *   - Today's usage vs limits
 *   - Lifetime stats
 *   - Quick action buttons
 *
 * The UsageTracking query here is a lightweight read —
 * the heavy lifting is done by the UsageService in Phase 7.
 */

const { sendMessage }   = require('../../services/bot/telegramService');
const { UsageTracking } = require('../../models');
const config            = require('../../config/env');

async function profileCommand(msg) {
  const { user, chatId } = msg._ctx;

  const isPremium   = user.isPremium;
  const planLabel   = isPremium ? '⭐ Premium' : '🆓 Free';
  const joinedDate  = new Date(user.createdAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Fetch today's usage
  const today    = new Date().toISOString().slice(0, 10);
  const limits   = isPremium ? config.limits.premium : config.limits.free;
  const usage    = await UsageTracking.findOne({ telegramId: user.telegramId, date: today });
  const msgUsed  = usage?.messagesUsed  ?? 0;
  const imgUsed  = usage?.imagesUsed    ?? 0;

  // Build usage bar (visual progress indicator)
  function usageBar(used, limit, width = 10) {
    const filled = Math.min(Math.round((used / limit) * width), width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  const text =
    `👤 <b>${user.displayName}'s Profile</b>\n\n` +

    `🏷️ Plan: <b>${planLabel}</b>` +
    (isPremium && user.planExpiresAt
      ? ` · expires ${new Date(user.planExpiresAt).toLocaleDateString()}`
      : '') + '\n' +
    `📅 Member since: ${joinedDate}\n` +
    `🌐 Language: ${user.languageCode?.toUpperCase() || 'EN'}\n` +
    `✨ Personality: <b>${user.activePersonality}</b>\n\n` +

    `<b>📊 Today's Usage</b>\n` +
    `💬 Messages: ${msgUsed}/${isPremium ? 'Unlimited' : limits.dailyMessages}\n` +
    `   ${isPremium ? '█'.repeat(10) : usageBar(msgUsed, limits.dailyMessages)}\n` +
    `🖼️ Images: ${imgUsed}/${limits.dailyImages}\n` +
    `   ${usageBar(imgUsed, limits.dailyImages)}\n\n` +

    `<b>📈 All-time Stats</b>\n` +
    `💬 Total messages: ${user.stats?.totalMessages ?? 0}\n` +
    `🖼️ Total images: ${user.stats?.totalImages ?? 0}\n` +
    `💬 Total conversations: ${user.stats?.totalConversations ?? 0}\n`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '⚙️ Settings',    callback_data: 'action:settings' },
        { text: '🧠 My memories', callback_data: 'action:memory' },
      ],
      ...(!isPremium
        ? [[{ text: '⭐ Upgrade to Premium', callback_data: 'action:premium' }]]
        : []),
    ],
  };

  await sendMessage(chatId, text, { reply_markup: keyboard });
}

module.exports = { profileCommand };
