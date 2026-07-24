'use strict';

/**
 * Memory Callback Handler
 *
 * Handles callbacks with namespace 'memory':
 *   memory:view:<id>    — show full memory content
 *   memory:delete:<id>  — delete a single memory
 */

const { sendMessage, editMessage } = require('../../services/bot/telegramService');
const { Memory }                   = require('../../models');
const logger                       = require('../../utils/logger');

const catEmoji = {
  personal:     '👤',
  preferences:  '❤️',
  professional: '💼',
  emotional:    '💭',
  temporal:     '📅',
  other:        '📝',
};

async function handleMemoryCallback(action, query, ctx) {
  const { user, chatId } = ctx;
  const messageId = query.message?.message_id;

  // ── View full memory ──────────────────────────────────────────────────
  if (action.startsWith('view:')) {
    const memoryId = action.replace('view:', '');
    const memory   = await Memory.findOne({ _id: memoryId, userId: user._id }).lean();

    if (!memory) {
      await sendMessage(chatId, '❓ Memory not found.');
      return;
    }

    const emoji = catEmoji[memory.category] || '📝';
    await sendMessage(
      chatId,
      `${emoji} <b>${capitalize(memory.category)} Memory</b>\n\n` +
      `<i>${memory.content}</i>\n\n` +
      `Importance: ${'⭐'.repeat(Math.round(memory.importance * 5))}\n` +
      `Saved: ${new Date(memory.createdAt).toLocaleDateString()}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🗑️ Delete this memory', callback_data: `memory:delete:${memoryId}` },
            { text: '← Back',               callback_data: 'action:memory' },
          ]],
        },
      }
    );
    return;
  }

  // ── Delete single memory ──────────────────────────────────────────────
  if (action.startsWith('delete:')) {
    const memoryId = action.replace('delete:', '');
    const memory   = await Memory.findOne({ _id: memoryId, userId: user._id });

    if (!memory) {
      await sendMessage(chatId, '❓ Memory not found or already deleted.');
      return;
    }

    memory.isActive = false;
    await memory.save();

    // Edit the original message to reflect deletion
    await editMessage(
      chatId,
      messageId,
      `✅ Memory deleted.\n\n<i>${memory.content.slice(0, 100)}</i>\n\nUse /memory to see remaining memories.`
    ).catch(() => {
      sendMessage(chatId, '✅ Memory deleted! Use /memory to see your remaining memories.');
    });

    logger.info('Memory deleted by user', {
      telegramId: user.telegramId,
      memoryId,
    });
    return;
  }

  logger.warn('Unknown memory action', { action, chatId });
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

module.exports = { handleMemoryCallback };
