'use strict';

/**
 * Telegram Bot Service
 *
 * Singleton wrapper around node-telegram-bot-api.
 * All bot interactions go through this service — never instantiate
 * TelegramBot directly in handlers.
 *
 * Why webhook mode (not polling)?
 *   - Polling opens a persistent outbound connection from our server.
 *     Webhooks let Telegram push updates — lower latency, no idle connections,
 *     works correctly in cluster mode (multiple PM2 workers).
 *   - In development we use polling for convenience (no public URL needed).
 *
 * Typing simulation:
 *   sendTyping() → sendMessage() pattern makes the bot feel human.
 *   The typing indicator auto-cancels when the message arrives.
 */

const TelegramBot = require('node-telegram-bot-api');
const config = require('../../config/env');
const logger = require('../../utils/logger');

// ---------------------------------------------------------------------------
// Singleton instance
// ---------------------------------------------------------------------------
let botInstance = null;

/**
 * Initialise the bot in the correct mode based on environment.
 * Called once from the bot initialiser (src/bot/index.js).
 */
function initBot() {
  if (botInstance) return botInstance;

  if (config.isDevelopment) {
    // Polling mode — convenient for local dev, no tunnel needed
    botInstance = new TelegramBot(config.telegram.token, {
      polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 },
      },
    });
    logger.info('Telegram bot started in POLLING mode (development)');
  } else {
    // Webhook mode — production
    // We do NOT pass webHook config here; Express handles the HTTP layer.
    // We just tell the library to expect manual update injection via
    // bot.processUpdate() in the webhook route.
    botInstance = new TelegramBot(config.telegram.token, { polling: false });
    logger.info('Telegram bot started in WEBHOOK mode (production)');
  }

  // Global bot error handler — prevents unhandled rejection crashes
  botInstance.on('polling_error', (err) => {
    logger.error(`Telegram polling error: ${err.message}`, { code: err.code });
  });

  botInstance.on('webhook_error', (err) => {
    logger.error(`Telegram webhook error: ${err.message}`);
  });

  return botInstance;
}

/**
 * Get the singleton bot instance.
 * Throws if initBot() hasn't been called yet.
 */
function getBot() {
  if (!botInstance) {
    throw new Error('Bot not initialised. Call initBot() first.');
  }
  return botInstance;
}

// ---------------------------------------------------------------------------
// Helper wrappers
// All helpers log errors and re-throw so callers can handle gracefully.
// ---------------------------------------------------------------------------

/**
 * Send a text message with optional keyboard markup.
 * Automatically uses HTML parse mode for rich formatting.
 */
async function sendMessage(chatId, text, options = {}) {
  const bot = getBot();
  try {
    return await bot.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      ...options,
    });
  } catch (err) {
    logger.error('sendMessage failed', { chatId, error: err.message });
    throw err;
  }
}

/**
 * Send a typing indicator.
 * Fire-and-forget — we don't await this in the message flow
 * so it doesn't delay the AI response.
 */
function sendTyping(chatId) {
  const bot = getBot();
  bot.sendChatAction(chatId, 'typing').catch((err) => {
    logger.warn('sendTyping failed', { chatId, error: err.message });
  });
}

/**
 * Send an upload photo chat action indicator.
 */
function sendUploadPhoto(chatId) {
  const bot = getBot();
  bot.sendChatAction(chatId, 'upload_photo').catch((err) => {
    logger.warn('sendUploadPhoto failed', { chatId, error: err.message });
  });
}

/**
 * Send a photo by URL or file_id.
 */
async function sendPhoto(chatId, photo, options = {}) {
  const bot = getBot();
  try {
    return await bot.sendPhoto(chatId, photo, {
      parse_mode: 'HTML',
      ...options,
    });
  } catch (err) {
    logger.error('sendPhoto failed', { chatId, error: err.message });
    throw err;
  }
}

/**
 * Edit an existing bot message (used for streaming / regeneration).
 */
async function editMessage(chatId, messageId, newText, options = {}) {
  const bot = getBot();
  try {
    return await bot.editMessageText(newText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      ...options,
    });
  } catch (err) {
    // Telegram throws if content didn't change — not a real error
    if (err.message?.includes('message is not modified')) return null;
    logger.error('editMessage failed', { chatId, messageId, error: err.message });
    throw err;
  }
}

/**
 * Edit an existing photo message's caption.
 */
async function editMessageCaption(chatId, messageId, newCaption, options = {}) {
  const bot = getBot();
  try {
    return await bot.editMessageCaption(newCaption, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      ...options,
    });
  } catch (err) {
    if (err.message?.includes('message is not modified')) return null;
    logger.error('editMessageCaption failed', { chatId, messageId, error: err.message });
    throw err;
  }
}

/**
 * Answer a callback query (dismisses the loading spinner on inline buttons).
 */
async function answerCallback(callbackQueryId, text = '', showAlert = false) {
  const bot = getBot();
  try {
    return await bot.answerCallbackQuery(callbackQueryId, {
      text,
      show_alert: showAlert,
    });
  } catch (err) {
    logger.warn('answerCallback failed', { callbackQueryId, error: err.message });
  }
}

/**
 * Answer a pre-checkout query (approve or reject a Stars payment).
 */
async function answerPreCheckout(preCheckoutQueryId, ok, errorMessage = null) {
  const bot = getBot();
  try {
    return await bot.answerPreCheckoutQuery(preCheckoutQueryId, ok, {
      error_message: errorMessage,
    });
  } catch (err) {
    logger.error('answerPreCheckout failed', {
      preCheckoutQueryId,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Send a Telegram Stars invoice.
 */
async function sendInvoice(chatId, invoiceData) {
  const bot = getBot();
  try {
    return await bot.sendInvoice(
      chatId,
      invoiceData.title,
      invoiceData.description,
      invoiceData.payload,
      '', // provider_token — empty string for Telegram Stars
      'XTR', // currency code for Telegram Stars
      invoiceData.prices, // [{ label, amount }]
      {
        need_name: false,
        need_phone_number: false,
        need_email: false,
        need_shipping_address: false,
        is_flexible: false,
        ...invoiceData.options,
      }
    );
  } catch (err) {
    logger.error('sendInvoice failed', { chatId, error: err.message });
    throw err;
  }
}

/**
 * Delete a message (used for cleanup after inline keyboard interactions).
 */
async function deleteMessage(chatId, messageId) {
  const bot = getBot();
  try {
    return await bot.deleteMessage(chatId, messageId);
  } catch (err) {
    // Message may already be deleted — not critical
    logger.warn('deleteMessage failed', { chatId, messageId, error: err.message });
  }
}

/**
 * Set bot commands visible in the Telegram UI menu.
 * Called once during bot initialisation.
 */
async function setBotCommands() {
  const bot = getBot();
  const commands = [
    { command: 'start',       description: '👋 Start chat & roleplay with AI GF' },
    { command: 'help',        description: '❓ How to chat & request uncensored pics' },
    { command: 'profile',     description: '👤 View your VIP profile status' },
    { command: 'girlfriends', description: '👙 Switch my active hot girlfriend' },
    { command: 'premium',     description: '⭐ Get premium pass for uncensored content 🔞' },
    { command: 'memory',      description: '🧠 Manage what she remembers about you' },
    { command: 'reset',       description: '🔄 Clear chat & start a new roleplay' },
    { command: 'images',      description: '🖼️ View your generated hot photos history' },
    { command: 'videos',      description: '🎬 Uncensored Premium VIP Videos 🔞' },
    { command: 'usage',       description: '📊 Check your daily message & image limits' },
    { command: 'settings',    description: '⚙️ Toggle Direct Image Mode & settings' },
  ];

  try {
    await bot.setMyCommands(commands);
    logger.info('Bot commands registered in Telegram menu');
  } catch (err) {
    logger.error('Failed to set bot commands', { error: err.message });
  }
}

module.exports = {
  initBot,
  getBot,
  sendMessage,
  sendTyping,
  sendUploadPhoto,
  sendPhoto,
  editMessage,
  editMessageCaption,
  answerCallback,
  answerPreCheckout,
  sendInvoice,
  deleteMessage,
  setBotCommands,
};
