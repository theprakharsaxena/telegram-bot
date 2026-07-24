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
const logger                        = require('../../utils/logger');

async function handleCallback(query, ctx) {
  const { data, message } = query;
  const chatId = message?.chat?.id;

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

module.exports = { handleCallback };
