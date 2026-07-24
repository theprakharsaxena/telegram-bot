'use strict';

/**
 * /reset Command Handler
 *
 * Asks for confirmation before clearing conversation history.
 * Two-step flow:
 *   /reset → confirmation prompt with Yes/No buttons
 *   Tap "Yes" → resetConversation() → fresh start message
 *   Tap "No"  → cancelled message
 *
 * Memories are NOT deleted by this command (use /settings → Clear memories).
 */

const { sendMessage } = require('../../services/bot/telegramService');

async function resetCommand(msg) {
  const { user, chatId } = msg._ctx;

  await sendMessage(
    chatId,
    `🔄 <b>Reset Conversation?</b>\n\n` +
    `This will clear your current chat history with <b>${user.activePersonality}</b>.\n\n` +
    `<i>Note: Your memories won't be affected — I'll still remember things about you.</i>\n\n` +
    `Are you sure?`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Yes, reset',  callback_data: 'reset:confirm' },
            { text: '❌ No, cancel',  callback_data: 'reset:cancel' },
          ],
        ],
      },
    }
  );
}

module.exports = { resetCommand };
