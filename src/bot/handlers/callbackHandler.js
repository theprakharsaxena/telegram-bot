'use strict';

/**
 * Callback Query Handler — Central Router
 *
 * All inline keyboard callbacks flow through here.
 * Splits on ':' to get namespace, then delegates to the
 * appropriate sub-handler.
 *
 * Namespace routing:
 *   action:*        — generic UI actions (chat, help, back, etc.)
 *   settings:*      — settings toggles and sub-menus
 *   reset:*         — conversation reset confirmation
 *   personality:*   — personality selection
 *   payment:*       — Telegram Stars payments (Phase 9)
 */

const { sendMessage }              = require('../../services/bot/telegramService');
const { handleSettingsCallback,
        handleResetCallback }      = require('./settingsCallbackHandler');
const { handlePersonalityCallback } = require('./personalityCallbackHandler');
const { handlePaymentCallback }    = require('./paymentCallbackHandler');
const { handleMemoryCallback }     = require('./memoryCallbackHandler');
const config                       = require('../../config/env');
const logger                        = require('../../utils/logger');

async function handleCallback(query, ctx) {
  const { data, message } = query;
  const chatId = message?.chat?.id;

  logger.info('Callback received', { data, chatId, hasCtx: !!ctx, hasUser: !!ctx?.user });

  if (!data || !chatId) return;

  // Split only on first two colons so payloads can contain ':'
  // e.g. 'personality:select:luna' → ['personality', 'select:luna']
  const colonIdx   = data.indexOf(':');
  const namespace  = colonIdx === -1 ? data : data.slice(0, colonIdx);
  const rest       = colonIdx === -1 ? '' : data.slice(colonIdx + 1);

  try {
    switch (namespace) {
      case 'action':
        await handleAction(rest, chatId, query, ctx);
        break;

      case 'settings':
        await handleSettingsCallback(rest, query, ctx);
        break;

      case 'reset':
        await handleResetCallback(rest, query, ctx);
        break;

      case 'personality':
        await handlePersonalityCallback(rest, query, ctx);
        break;

      case 'payment':
        await handlePaymentCallback(rest, query, ctx);
        break;

      case 'memory':
        await handleMemoryCallback(rest, query, ctx);
        break;

      case 'adsgram':
        await handleAdsgramCallback(rest, query, ctx);
        break;

      default:
        logger.warn('Unknown callback namespace', { data, chatId });
    }
  } catch (err) {
    logger.error('callbackHandler error', { data, chatId, error: err.message });
    await sendMessage(chatId, '😔 Something went wrong. Please try again!').catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Generic action handler
// ---------------------------------------------------------------------------
async function handleAction(action, chatId, query, ctx) {
  if (action.startsWith('send_text:')) {
    const text = action.replace('send_text:', '');
    const { handleChatMessage } = require('./chatHandler');
    const syntheticMsg = {
      chat: { id: chatId },
      text: text,
      _ctx: ctx,
    };
    await handleChatMessage(syntheticMsg);
    return;
  }

  switch (action) {
    case 'chat':
      await sendMessage(chatId, "💬 I'm all ears — just send me a message!");
      break;

    case 'help': {
      // Invoke the help command directly
      const { helpCommand } = require('../commands/help');
      const syntheticMsg = { _ctx: ctx };
      await helpCommand(syntheticMsg);
      break;
    }

    case 'premium':
      await sendMessage(
        chatId,
        '⭐ <b>Premium Plans</b>\n\nUse /premium to see pricing and subscribe with Telegram Stars!'
      );
      break;

    case 'personalities': {
      const { personalityCommand } = require('../commands/personality');
      const syntheticMsg = { _ctx: ctx };
      await personalityCommand(syntheticMsg);
      break;
    }

    case 'settings': {
      const { settingsCommand } = require('../commands/settings');
      const syntheticMsg = { _ctx: ctx };
      await settingsCommand(syntheticMsg);
      break;
    }

    case 'profile': {
      const { profileCommand } = require('../commands/profile');
      const syntheticMsg = { _ctx: ctx };
      await profileCommand(syntheticMsg);
      break;
    }

    case 'usage': {
      const { usageCommand } = require('../commands/usage');
      const syntheticMsg = { _ctx: ctx };
      await usageCommand(syntheticMsg);
      break;
    }

    case 'memory': {
      const { memoryCommand } = require('../commands/memory');
      const syntheticMsg = { _ctx: ctx };
      await memoryCommand(syntheticMsg);
      break;
    }

    case 'back':
      // Generic back — just dismiss with no message (sub-handlers edit in place)
      break;

    default:
      logger.warn('Unknown action in callback', { action, chatId });
  }
}

// ---------------------------------------------------------------------------
// Adsgram rewarded ad handler
// ---------------------------------------------------------------------------
async function handleAdsgramCallback(action, query, ctx) {
  const { user, chatId } = ctx;

  logger.info('Adsgram callback', { action, hasUser: !!user, telegramId: user?.telegramId, chatId });

  if (!user) {
    logger.error('Adsgram callback: user not found in context', { ctx });
    await sendMessage(chatId, '😔 User data not found. Please try /start again.');
    return;
  }

  if (!config.adsgram.enabled) {
    await sendMessage(chatId, '😔 Ads are currently disabled.');
    return;
  }

  if (!config.adsgram.botId || !config.adsgram.adUnitId) {
    logger.error('Adsgram config missing', { botId: config.adsgram.botId, adUnitId: config.adsgram.adUnitId });
    await sendMessage(chatId, '😔 Ad system not configured properly. Please contact support.');
    return;
  }

  if (user.isPremium) {
    await sendMessage(chatId, '⭐ You already have premium! No need to watch ads.');
    return;
  }

  if (action === 'watch') {
    // Send the Adsgram rewarded ad
    // The user must first start the Adsgram bot, then we can send them to the ad
    // Format: https://t.me/{botId}?start={adUnitId}_{userId}
    const adUrl = `https://t.me/${config.adsgram.botId}?start=${config.adsgram.adUnitId}_${user.telegramId}`;

    logger.info('Sending Adsgram ad URL', { adUrl, telegramId: user.telegramId });

    await sendMessage(
      chatId,
      `🎬 <b>Watch Ad to Get Bonus Credits!</b>\n\n` +
      `Watch this short ad to receive:\n` +
      `• +${config.adsgram.bonusMessages} message credits\n` +
      `• +${config.adsgram.bonusImages} image credits\n\n` +
      `<b>⚠️ IMPORTANT - Follow these steps:</b>\n` +
      `1. First click "🤖 Start Adsgram Bot" below\n` +
      `2. Send /start to the Adsgram bot\n` +
      `3. Then come back here and click "🎬 Watch Ad Now"\n\n` +
      `If you skip step 1-2, you'll get an error saying "user doesn't exist".\n\n` +
      `Rewards are granted automatically after watching the full ad.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🤖 Step 1: Start Adsgram Bot',
                url: `https://t.me/${config.adsgram.botId}?start`,
              },
            ],
            [
              {
                text: '🎬 Step 2: Watch Ad Now',
                url: adUrl,
              },
            ],
            [{ text: '❌ Cancel', callback_data: 'back' }],
          ],
        },
      }
    );
  }
}

module.exports = { handleCallback };
