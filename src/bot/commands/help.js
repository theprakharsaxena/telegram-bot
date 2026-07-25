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
    `📖 <b>${config.bot.name} — VIP Companion Guide</b>\n` +
    `Your current status: <b>${planBadge}</b>\n\n` +

    `<b>💬 Chatting & Roleplay</b> 💋\n` +
    `Just send me any message to start talking! I remember our conversations and learn about your desires over time.\n\n` +

    `<b>🖼️ Uncensored Images</b> 🔞\n` +
    `Ask me to generate a hot photo of myself naturally:\n` +
    `<i>"Send me a selfie"</i>\n` +
    `<i>"Show me your boobs"</i>\n` +
    `<i>"Imagine you in hot lingerie"</i>\n\n` +

    `<b>📋 VIP Commands</b> ⚙️\n` +
    `/start — 👋 Welcome greeting & hot examples\n` +
    `/help — ❓ Show this help guide\n` +
    `/profile — 👤 View your profile & stats\n` +
    `/girlfriends — 👙 Switch my active hot girlfriend\n` +
    `/premium — ⭐ Unlock unlimited uncensored pics & chat\n` +
    `/memory — 🧠 Manage what she remembers about you\n` +
    `/reset — 🔄 Clear chat & start a new roleplay\n` +
    `/images — 🖼️ Browse your generated hot photos history\n` +
    `/usage — 📊 Check today's message & image usage\n` +
    `/settings — ⚙️ Toggle Direct Image Mode & preferences\n\n` +

    `<b>📊 Your Limits Today</b>\n` +
    (isPremium
      ? `💬 Unlimited chat & roleplay\n` +
        `🖼️ ${config.limits.premium.dailyImages} uncensored 🔞 images\n` +
        `🧠 ${config.limits.premium.memoryLimit} memories stored\n`
      : `💬 ${config.limits.free.dailyMessages} messages\n` +
        `🖼️ ${config.limits.free.dailyImages} images\n` +
        `🧠 ${config.limits.free.memoryLimit} memories stored\n`) +
    `\n` +
    (!isPremium
      ? `⭐ <b>Upgrade to VIP Premium Pass</b> for unlimited chats, 30 uncensored 🔞 images per day, and all hot exclusive girlfriends → /premium\n`
      : `✨ You're on Premium — enjoy the uncensored roleplay experience! 💋\n`);

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💬 Chat now',      callback_data: 'action:chat' },
        { text: '✨ Girlfriends', callback_data: 'action:personalities' },
      ],
      ...(!isPremium
        ? [[{ text: '⭐ Upgrade to Premium', callback_data: 'action:premium' }]]
        : []),
    ],
  };

  await sendMessage(chatId, text, { reply_markup: keyboard });
}

module.exports = { helpCommand };
