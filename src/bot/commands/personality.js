'use strict';

/**
 * /personality Command Handler
 *
 * Lists all available personalities as an inline keyboard.
 * Each button shows the personality name, emoji, and whether it's
 * premium-only. Tapping one triggers personalityCallbackHandler.
 */

const { sendMessage }   = require('../../services/bot/telegramService');
const { AdminSettings } = require('../../models');

async function personalityCommand(msg) {
  const { user, chatId } = msg._ctx;

  const settings       = await AdminSettings.getSettings();
  const personalities  = settings.personalities.filter((p) => p.isActive);
  const currentKey     = user.activePersonality;
  const isPremium      = user.isPremium;

  const rows = personalities.map((p) => {
    const isCurrent  = p.key === currentKey;
    const isLocked   = p.isPremiumOnly && !isPremium;
    const label =
      (isCurrent  ? '✓ ' : '') +
      `${p.emoji} ${p.name}` +
      (isLocked   ? ' 🔒' : '') +
      (isCurrent  ? ' (active)' : '');

    return [
      {
        text: label,
        callback_data: isLocked
          ? 'personality:locked'
          : `personality:select:${p.key}`,
      },
    ];
  });

  // Current personality description
  const current = personalities.find((p) => p.key === currentKey);
  const desc    = current
    ? `\n<i>Currently chatting with <b>${current.emoji} ${current.name}</b> — ${current.description}</i>`
    : '';

  await sendMessage(
    chatId,
    `✨ <b>Choose a Personality</b>${desc}\n\nSelect who you'd like to talk to:`,
    {
      reply_markup: {
        inline_keyboard: [
          ...rows,
          [{ text: '← Back', callback_data: 'action:back' }],
        ],
      },
    }
  );
}

module.exports = { personalityCommand };
