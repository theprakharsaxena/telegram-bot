'use strict';

/**
 * Settings Callback Handler
 *
 * Handles all callbacks with namespace 'settings' and 'reset'.
 *
 * Supported callback_data values:
 *   settings:toggle:<field>         — flip a boolean preference
 *   settings:style_menu             — show response style sub-menu
 *   settings:style_set:<value>      — set response style
 *   settings:clear_memories_confirm — ask for confirmation
 *   settings:clear_memories_do      — actually clear memories
 *   settings:delete_account_confirm — ask for confirmation
 *   settings:delete_account_do      — actually delete account
 *   reset:confirm                   — execute reset
 *   reset:cancel                    — cancel reset
 */

const { sendMessage, editMessage } = require('../../services/bot/telegramService');
const userService                   = require('../../services/userService');
const { buildSettingsText, buildSettingsKeyboard } = require('../commands/settings');
const logger                        = require('../../utils/logger');

const STYLE_OPTIONS = ['casual', 'romantic', 'friendly', 'professional'];

/**
 * Main entry point called from callbackHandler.js.
 * @param {string} action   — everything after 'settings:'
 * @param {object} query    — original Telegram callbackQuery object
 * @param {object} ctx      — { user, chatId } from botAuth
 */
async function handleSettingsCallback(action, query, ctx) {
  const { user, chatId } = ctx;
  const messageId = query.message?.message_id;

  // ── Toggle boolean preferences ──────────────────────────────────────────
  if (action.startsWith('toggle:')) {
    const field = action.replace('toggle:', '');
    const toggleable = ['typingSimulation', 'memoryEnabled', 'notificationsEnabled', 'directImageMode'];

    if (!toggleable.includes(field)) {
      return sendMessage(chatId, '❓ Unknown setting.');
    }

    const current   = user.preferences[field];
    const updated   = await userService.updatePreferences(user.telegramId, {
      [field]: !current,
    });

    // Edit the original settings message in-place so it feels seamless
    await editMessage(
      chatId,
      messageId,
      buildSettingsText(updated.preferences),
      { reply_markup: buildSettingsKeyboard(updated.preferences) }
    );
    return;
  }

  // ── Response style sub-menu ────────────────────────────────────────────
  if (action === 'style_menu') {
    const rows = STYLE_OPTIONS.map((style) => [
      {
        text:
          (user.preferences.responseStyle === style ? '✓ ' : '') +
          capitalize(style),
        callback_data: `settings:style_set:${style}`,
      },
    ]);

    await editMessage(
      chatId,
      messageId,
      `🗣 <b>Choose Response Style</b>\n\n` +
        `<b>Casual</b> — relaxed, everyday conversation\n` +
        `<b>Romantic</b> — warm, affectionate tone\n` +
        `<b>Friendly</b> — upbeat and supportive\n` +
        `<b>Professional</b> — clear and composed`,
      {
        reply_markup: {
          inline_keyboard: [
            ...rows,
            [{ text: '← Back to Settings', callback_data: 'settings:back' }],
          ],
        },
      }
    );
    return;
  }

  // ── Set response style ─────────────────────────────────────────────────
  if (action.startsWith('style_set:')) {
    const style = action.replace('style_set:', '');
    if (!STYLE_OPTIONS.includes(style)) {
      return sendMessage(chatId, '❓ Unknown style.');
    }
    const updated = await userService.updatePreferences(user.telegramId, {
      responseStyle: style,
    });
    await editMessage(
      chatId,
      messageId,
      buildSettingsText(updated.preferences),
      { reply_markup: buildSettingsKeyboard(updated.preferences) }
    );
    return;
  }

  // ── Back to settings main menu ─────────────────────────────────────────
  if (action === 'back') {
    // Re-fetch user to get latest prefs
    const freshUser = await userService.getUserByTelegramId(user.telegramId);
    await editMessage(
      chatId,
      messageId,
      buildSettingsText(freshUser.preferences),
      { reply_markup: buildSettingsKeyboard(freshUser.preferences) }
    );
    return;
  }

  // ── Clear memories — confirmation ─────────────────────────────────────
  if (action === 'clear_memories_confirm') {
    await editMessage(
      chatId,
      messageId,
      `🧠 <b>Clear All Memories?</b>\n\n` +
        `I'll forget everything I know about you — your name, preferences, and personal details.\n\n` +
        `This cannot be undone. Are you sure?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, forget everything', callback_data: 'settings:clear_memories_do' },
              { text: '❌ Cancel',                  callback_data: 'settings:back' },
            ],
          ],
        },
      }
    );
    return;
  }

  // ── Clear memories — execute ───────────────────────────────────────────
  if (action === 'clear_memories_do') {
    await userService.clearMemories(user.telegramId);
    await editMessage(
      chatId,
      messageId,
      `🧠 Done — all your memories have been cleared.\n\nI'm starting fresh. What would you like to share? 💫`
    );
    return;
  }

  // ── Delete account — confirmation ──────────────────────────────────────
  if (action === 'delete_account_confirm') {
    await editMessage(
      chatId,
      messageId,
      `❌ <b>Delete Account?</b>\n\n` +
        `This will permanently anonymise your profile and clear all memories.\n` +
        `Your chat history is retained for abuse prevention.\n\n` +
        `<b>This cannot be undone.</b> Are you absolutely sure?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🗑️ Yes, delete my account', callback_data: 'settings:delete_account_do' },
              { text: '❌ Cancel',                   callback_data: 'settings:back' },
            ],
          ],
        },
      }
    );
    return;
  }

  // ── Delete account — execute ───────────────────────────────────────────
  if (action === 'delete_account_do') {
    await userService.deleteAccount(user.telegramId);
    await sendMessage(
      chatId,
      `Your account has been deleted. Your data has been anonymised.\n\n` +
        `If you'd like to start fresh, just send /start. Goodbye! 💙`
    );
    return;
  }

  logger.warn('Unknown settings action', { action, chatId });
}

/**
 * Handle reset:confirm and reset:cancel callbacks.
 */
async function handleResetCallback(action, query, ctx) {
  const { user, chatId } = ctx;
  const messageId = query.message?.message_id;

  if (action === 'confirm') {
    const result = await userService.resetConversation(user.telegramId);
    await editMessage(
      chatId,
      messageId,
      `🔄 <b>Conversation reset!</b>\n\n` +
        `Fresh start with <b>${result.personality}</b>. ` +
        `I still remember everything about you though! 💫\n\n` +
        `Say hi to get started again.`
    );
    return;
  }

  if (action === 'cancel') {
    await editMessage(
      chatId,
      messageId,
      `✅ No worries — your conversation is intact. Let's keep chatting!`
    );
    return;
  }

  logger.warn('Unknown reset action', { action, chatId });
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { handleSettingsCallback, handleResetCallback };
