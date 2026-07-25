'use strict';

/**
 * /start Command Handler
 *
 * First thing every new user sees. Responsibilities:
 *   - Warm, personality-consistent greeting
 *   - Brief feature overview
 *   - Show free plan limits so expectations are set
 *   - Inline keyboard for quick navigation
 *   - Track new user analytics
 */

const { sendMessage } = require('../../services/bot/telegramService');
const { Analytics }   = require('../../models');
const config          = require('../../config/env');
const logger          = require('../../utils/logger');

/**
 * @param {object} msg   — Telegram message object (with msg._ctx attached by botAuth)
 */
async function startCommand(msg) {
  const { user, chatId } = msg._ctx;

  const isNewUser = !user.stats.firstMessageAt ||
    (Date.now() - new Date(user.stats.firstMessageAt).getTime() < 5000);

  const firstName = user.firstName || 'there';

  // ── Greeting text ────────────────────────────────────────────────────────
  const greeting = isNewUser
    ? `✨ <b>Hey ${firstName}!</b> I'm <b>${config.bot.name}</b> — your AI companion.\n\n` +
      `I'm here to chat, listen, and keep you company. I'll remember things about you, ` +
      `generate images, and always be here when you need someone to talk to. 💫\n\n` +
      `<b>Here's what you get for free:</b>\n` +
      `💬 ${config.limits.free.dailyMessages} messages per day\n` +
      `🖼️ ${config.limits.free.dailyImages} AI images per day\n` +
      `🧠 I'll remember ${config.limits.free.memoryLimit} things about you\n\n` +
      `Want more? Check out <b>/premium</b> ⭐\n\n` +
      `<i>Just send me a message to get started!</i>`
    : `Welcome back, <b>${firstName}</b>! 💖 I missed you.\n\nWhat's on your mind today?`;

  // ── Inline keyboard ───────────────────────────────────────────────────────
  const keyboard = {
    inline_keyboard: [
      [
        { text: '💬 Start chatting', callback_data: 'action:chat' },
        { text: '✨ Girlfriends',  callback_data: 'action:personalities' },
      ],
      [
        { text: '⭐ Go Premium',  callback_data: 'action:premium' },
        { text: '❓ Help',        callback_data: 'action:help' },
      ],
    ],
  };

  await sendMessage(chatId, greeting, { reply_markup: keyboard });

  // ── Track new user in analytics (fire-and-forget) ─────────────────────────
  if (isNewUser) {
    const today = new Date().toISOString().slice(0, 10);
    Analytics.increment(today, { newUsers: 1 }).catch((err) => {
      logger.warn('Analytics increment failed for newUsers', { error: err.message });
    });
  }
}

module.exports = { startCommand };
