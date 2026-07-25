'use strict';

/**
 * /settings Command Handler
 *
 * Displays the current settings menu as an inline keyboard.
 * Each button toggles or opens a sub-menu for that setting.
 * All state changes go through settingsCallbackHandler.
 */

const { sendMessage } = require('../../services/bot/telegramService');

async function settingsCommand(msg) {
  const { user, chatId } = msg._ctx;
  const p = user.preferences;

  await sendMessage(chatId, buildSettingsText(p), {
    reply_markup: buildSettingsKeyboard(p),
  });
}

/**
 * Build the settings display text from current preferences.
 */
function buildSettingsText(prefs) {
  return (
    `⚙️ <b>Your Settings</b>\n\n` +
    `Tap any option below to change it.\n\n` +
    `🗣 Response style: <b>${capitalize(prefs.responseStyle)}</b>\n` +
    `🧠 Memory: <b>${prefs.memoryEnabled ? 'On' : 'Off'}</b>\n` +
    `🔔 Notifications: <b>${prefs.notificationsEnabled ? 'On' : 'Off'}</b>\n` +
    `🖼️ Direct Image Mode: <b>${prefs.directImageMode ? 'On' : 'Off'}</b>`
  );
}

/**
 * Build the inline keyboard showing current state for each toggle.
 */
function buildSettingsKeyboard(prefs) {
  return {
    inline_keyboard: [
      [
        {
          text: `🗣 Style: ${capitalize(prefs.responseStyle)}`,
          callback_data: 'settings:style_menu',
        },
      ],
      [
        {
          text: `🧠 Long-term memory: ${prefs.memoryEnabled ? '✅ On' : '❌ Off'}`,
          callback_data: 'settings:toggle:memoryEnabled',
        },
      ],
      [
        {
          text: `🔔 Notifications: ${prefs.notificationsEnabled ? '✅ On' : '❌ Off'}`,
          callback_data: 'settings:toggle:notificationsEnabled',
        },
      ],
      [
        {
          text: `🖼️ Direct Image Mode: ${prefs.directImageMode ? '✅ On' : '❌ Off'}`,
          callback_data: 'settings:toggle:directImageMode',
        },
      ],
      [
        { text: '🗑️ Clear memories',     callback_data: 'settings:clear_memories_confirm' },
      ],
      [
        { text: '❌ Delete account',      callback_data: 'settings:delete_account_confirm' },
      ],
      [{ text: '← Back',                 callback_data: 'action:back' }],
    ],
  };
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { settingsCommand, buildSettingsText, buildSettingsKeyboard };
