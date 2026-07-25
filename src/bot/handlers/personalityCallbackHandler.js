'use strict';

/**
 * Personality Callback Handler
 *
 * Handles callbacks with namespace 'personality':
 *   personality:select:<key>  — switch to this personality
 *   personality:locked         — inform user it's premium-only
 */

const { sendMessage, editMessage, editMessageCaption, sendPhoto } = require('../../services/bot/telegramService');
const userService                   = require('../../services/userService');
const { AdminSettings }             = require('../../models');
const logger                        = require('../../utils/logger');

/**
 * @param {string} action  — everything after 'personality:'
 * @param {object} query   — original Telegram callbackQuery object
 * @param {object} ctx     — { user, chatId } from botAuth
 */
async function handlePersonalityCallback(action, query, ctx) {
  const { user, chatId } = ctx;
  const messageId = query.message?.message_id;

  // ── Locked personality (premium only) ────────────────────────────────
  if (action === 'locked') {
    await sendMessage(
      chatId,
      `🔒 This personality is available for <b>Premium</b> members only.\n\n` +
        `Use /premium to upgrade and unlock all personalities! ⭐`
    );
    return;
  }

  // ── Select a personality ──────────────────────────────────────────────
  if (action.startsWith('select:')) {
    const personalityKey = action.replace('select:', '');

    // Already active — no-op
    if (user.activePersonality === personalityKey) {
      await sendMessage(chatId, `✨ You're already chatting with <b>${personalityKey}</b>!`);
      return;
    }

    try {
      const { user: updatedUser, personality } = await userService.switchPersonality(
        user.telegramId,
        personalityKey
      );

      // Update the personality list message to show new active state
      const settings      = await AdminSettings.getSettings();
      const personalities = settings.personalities.filter((p) => p.isActive);
      const isPremium     = updatedUser.isPremium;

      const rows = personalities.map((p) => {
        const isCurrent = p.key === personalityKey;
        const isLocked  = p.isPremiumOnly && !isPremium;
        const label =
          (isCurrent ? '✓ ' : '') +
          `${p.emoji} ${p.name}` +
          (isLocked  ? ' 🔒' : '') +
          (isCurrent ? ' (active)' : '');

        return [
          {
            text: label,
            callback_data: isLocked
              ? 'personality:locked'
              : `personality:select:${p.key}`,
          },
        ];
      });

      const updateText = `✨ <b>Personality switched to ${personality.emoji} ${personality.name}!</b>\n\n` +
          `<i>${personality.description}</i>\n\n` +
          `Select another or start chatting:`;
      const updateMarkup = {
        inline_keyboard: [
          ...rows,
          [{ text: '← Back', callback_data: 'action:back' }],
        ],
      };

      try {
        await editMessageCaption(chatId, messageId, updateText, { reply_markup: updateMarkup });
      } catch (editErr) {
        // Fallback to text message edit if the original menu was sent as a text message
        await editMessage(chatId, messageId, updateText, { reply_markup: updateMarkup });
      }

      // Send the greeting for the new personality as a fresh message
      if (personality.avatarUrls?.image1) {
        await sendPhoto(chatId, personality.avatarUrls.image1, {
          caption: personality.greeting,
          parse_mode: 'HTML'
        });
      } else {
        await sendMessage(chatId, personality.greeting);
      }
    } catch (err) {
      if (err.statusCode === 403) {
        await sendMessage(
          chatId,
          `🔒 <b>${personalityKey}</b> is a Premium-only personality.\n\nUse /premium to unlock! ⭐`
        );
      } else {
        logger.error('personalityCallbackHandler error', {
          action,
          chatId,
          error: err.message,
        });
        await sendMessage(chatId, '😔 Could not switch personality. Please try again.');
      }
    }
    return;
  }

  logger.warn('Unknown personality action', { action, chatId });
}

module.exports = { handlePersonalityCallback };
