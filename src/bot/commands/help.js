'use strict';

/**
 * /help Command Handler
 *
 * Full command reference with feature overview.
 * Adapts content based on whether the user is free or premium.
 */

const { sendMessage } = require('../../services/bot/telegramService');
const config          = require('../../config/env');

async function helpCommand(msg) {
  const { user, chatId } = msg._ctx;
  const isPremium = user.isPremium;

  const planBadge = isPremium ? '⭐ Premium' : '🆓 Free';

  const text =
    `📖 <b>${config.bot.name} — Help Guide</b>\n` +
    `Your current plan: <b>${planBadge}</b>\n\n` +

    `<b>💬 Chatting</b>\n` +
    `Just send me any message and I'll respond! I remember our conversations and learn about you over time.\n\n` +

    `<b>🖼️ Images</b>\n` +
    `Ask me to generate an image naturally:\n` +
    `<i>"Send me a selfie"</i>\n` +
    `<i>"Show us at the beach"</i>\n` +
    `<i>"Generate a photo of you in Paris"</i>\n\n` +

    `<b>📋 Commands</b>\n` +
    `/start — Restart and see the welcome message\n` +
    `/help — Show this guide\n` +
    `/profile — View your profile & usage stats\n` +
    `/personality — Switch between AI personalities\n` +
    `/premium — View & manage premium subscription\n` +
    `/memory — See and manage what I remember about you\n` +
    `/reset — Clear conversation history (fresh start)\n` +
    `/images — Browse your generated image history\n` +
    `/usage — Check today's message & image usage\n` +
    `/settings — Adjust your preferences\n\n` +

    `<b>📊 Your Daily Limits</b>\n` +
    (isPremium
      ? `💬 Unlimited chat\n` +
        `🖼️ ${config.limits.premium.dailyImages} images\n` +
        `🧠 ${config.limits.premium.memoryLimit} memories stored\n`
      : `💬 ${config.limits.free.dailyMessages} messages\n` +
        `🖼️ ${config.limits.free.dailyImages} images\n` +
        `🧠 ${config.limits.free.memoryLimit} memories stored\n`) +
    `\n` +
    (!isPremium
      ? `⭐ <b>Upgrade to Premium</b> for unlimited chats, more images, and exclusive personalities → /premium\n`
      : `✨ You're on Premium — enjoy the full experience!\n`);

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💬 Chat now',      callback_data: 'action:chat' },
        { text: '✨ Personalities', callback_data: 'action:personalities' },
      ],
      ...(!isPremium
        ? [[{ text: '⭐ Upgrade to Premium', callback_data: 'action:premium' }]]
        : []),
    ],
  };

  await sendMessage(chatId, text, { reply_markup: keyboard });
}

module.exports = { helpCommand };
