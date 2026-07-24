'use strict';

/**
 * /memory Command Handler
 *
 * Shows the user's stored memories with options to delete individual items
 * or clear everything. Respects plan memory limits.
 */

const { sendMessage } = require('../../services/bot/telegramService');
const { Memory }      = require('../../models');
const usageService    = require('../../services/usage/usageService');
const config          = require('../../config/env');

async function memoryCommand(msg) {
  const { user, chatId } = msg._ctx;
  const isPremium  = user.isPremium;
  const limits     = await usageService.getLimits();
  const memLimit   = isPremium
    ? limits.premium.memoryLimit
    : limits.free.memoryLimit;

  const memories = await Memory.find(
    { userId: user._id, isActive: true },
    { content: 1, category: 1, importance: 1, createdAt: 1 }
  )
    .sort({ importance: -1, createdAt: -1 })
    .limit(20)
    .lean();

  const total = await Memory.countDocuments({ userId: user._id, isActive: true });

  if (!memories.length) {
    await sendMessage(
      chatId,
      `🧠 <b>My Memories About You</b>\n\n` +
      `I don't remember anything specific yet!\n\n` +
      `As we chat more, I'll start remembering things about you — ` +
      `your name, interests, and whatever you share with me. 💫`
    );
    return;
  }

  // Category emoji map
  const catEmoji = {
    personal:     '👤',
    preferences:  '❤️',
    professional: '💼',
    emotional:    '💭',
    temporal:     '📅',
    other:        '📝',
  };

  // Build memory list (show up to 10 with inline delete buttons)
  const shown = memories.slice(0, 10);
  const rows  = shown.map((m, i) => [
    {
      text:          `${catEmoji[m.category] || '📝'} ${m.content.slice(0, 40)}${m.content.length > 40 ? '…' : ''}`,
      callback_data: `memory:view:${m._id}`,
    },
    {
      text:          '🗑️',
      callback_data: `memory:delete:${m._id}`,
    },
  ]);

  const text =
    `🧠 <b>My Memories About You</b>\n\n` +
    `I'm storing <b>${total}/${memLimit}</b> memories.\n` +
    `Tap a memory to see it, or 🗑️ to delete it.\n\n` +
    shown.map((m, i) =>
      `${i + 1}. ${catEmoji[m.category] || '📝'} <i>${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}</i>`
    ).join('\n') +
    (total > 10 ? `\n\n<i>…and ${total - 10} more</i>` : '');

  await sendMessage(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        ...rows,
        [
          { text: '🗑️ Clear all memories', callback_data: 'settings:clear_memories_confirm' },
        ],
      ],
    },
  });
}

module.exports = { memoryCommand };
