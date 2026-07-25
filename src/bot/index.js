'use strict';

/**
 * Bot Initialiser
 *
 * Called once from server.js after the DB and Redis are connected.
 * Responsibilities:
 *   1. Initialise the Telegram bot (polling or webhook mode)
 *   2. Register all event handlers
 *   3. Set bot commands in the Telegram menu
 *   4. Register the webhook with Telegram (production only)
 *
 * Handler registration order matters — more specific patterns first,
 * fallback text handler last.
 */

const {
  initBot,
  getBot,
  setBotCommands,
  sendMessage,
}                              = require('../services/bot/telegramService');
const { withBotAuth }          = require('./middleware/botAuth');
const { startCommand }         = require('./commands/start');
const { helpCommand }          = require('./commands/help');
const { profileCommand }       = require('./commands/profile');
const { settingsCommand }      = require('./commands/settings');
const { personalityCommand }   = require('./commands/personality');
const { resetCommand }         = require('./commands/reset');
const { usageCommand }         = require('./commands/usage');
const { imagesCommand }        = require('./commands/images');
const { premiumCommand }       = require('./commands/premium');
const { memoryCommand }        = require('./commands/memory');
const { videosCommand }        = require('./commands/videos');
const { handleCallback }       = require('./handlers/callbackHandler');
const { handleChatMessage }    = require('./handlers/chatHandler');
const paymentService           = require('../services/payment/paymentService');
const config                   = require('../config/env');
const logger                   = require('../utils/logger');

/**
 * Placeholder handler for commands not yet implemented.
 */
function comingSoon(label) {
  return withBotAuth(async (msg) => {
    const { chatId } = msg._ctx;
    await sendMessage(chatId, `🔧 <b>${label}</b> is being set up — check back soon!`);
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function initBotHandlers() {
  const bot = initBot();

  // ── Commands ─────────────────────────────────────────────────────────────
  bot.onText(/\/start(@\S+)?/,       withBotAuth(startCommand));
  bot.onText(/\/help(@\S+)?/,        withBotAuth(helpCommand));
  bot.onText(/\/profile(@\S+)?/,     withBotAuth(profileCommand));
  bot.onText(/\/settings(@\S+)?/,    withBotAuth(settingsCommand));
  bot.onText(/\/girlfriends(@\S+)?/, withBotAuth(personalityCommand));
  bot.onText(/\/reset(@\S+)?/,       withBotAuth(resetCommand));
  bot.onText(/\/usage(@\S+)?/,       withBotAuth(usageCommand));

  // Stubs for later phases
  bot.onText(/\/premium(@\S+)?/, withBotAuth(premiumCommand));
  bot.onText(/\/memory(@\S+)?/,  withBotAuth(memoryCommand));
  bot.onText(/\/images(@\S+)?/,  withBotAuth(imagesCommand));
  bot.onText(/\/videos(@\S+)?/,  withBotAuth(videosCommand));

  // ── Text messages → AI handler ────────────────────────────────────────────
  bot.on('message', (msg) => {
    if (msg.text?.startsWith('/')) return; // already handled by onText
    if (!msg.text) return;                 // photos/voice handled in Phase 5
    withBotAuth(handleChatMessage)(msg);
  });

  // ── Callback queries ──────────────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const { id: callbackId, data, message, from } = query;
    const chatId = message?.chat?.id;

    await bot.answerCallbackQuery(callbackId).catch(() => {});
    if (!data || !chatId || !from) return;

    const syntheticMsg = { chat: { id: chatId, type: 'private' }, from, text: '' };

    withBotAuth(async (msg) => {
      await handleCallback(query, msg._ctx);
    })(syntheticMsg);
  });

  // ── Payment handlers ─────────────────────────────────────────────────────
  bot.on('pre_checkout_query', async (query) => {
    logger.info('pre_checkout_query received', {
      id:      query.id,
      payload: query.invoice_payload,
      from:    query.from?.id,
    });
    try {
      const { ok, errorMessage } = await paymentService.handlePreCheckout(query);
      await bot.answerPreCheckoutQuery(query.id, ok, {
        error_message: errorMessage || undefined,
      });
    } catch (err) {
      logger.error('pre_checkout_query handler error', { error: err.message });
      await bot.answerPreCheckoutQuery(query.id, false, {
        error_message: 'Internal error. Please try again.',
      }).catch(() => {});
    }
  });

  // successful_payment arrives as a regular message
  bot.on('message', (msg) => {
    if (msg.successful_payment) {
      logger.info('Successful payment received', {
        telegramId: msg.from?.id,
        chargeId:   msg.successful_payment.telegram_payment_charge_id,
        payload:    msg.successful_payment.invoice_payload,
      });
      // Process asynchronously — don't block the message listener
      paymentService.handleSuccessfulPayment(msg).catch((err) => {
        logger.error('handleSuccessfulPayment error', { error: err.message });
      });
    }
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  bot.on('error', (err) => {
    logger.error('Telegram bot error', { error: err.message });
  });

  await setBotCommands();

  if (config.isProduction) {
    await registerWebhook();
  }

  logger.info('Bot handlers registered successfully');
  return bot;
}

async function registerWebhook() {
  const bot        = getBot();
  const webhookUrl = `${config.telegram.webhookUrl}/webhook/${config.telegram.token}`;

  try {
    await bot.setWebHook(webhookUrl, {
      secret_token:     config.telegram.webhookSecret,
      max_connections:  40,
      allowed_updates:  ['message', 'callback_query', 'pre_checkout_query'],
    });
    logger.info(`Webhook registered: ${webhookUrl}`);
  } catch (err) {
    logger.error('Failed to register webhook', { error: err.message });
    throw err;
  }
}

module.exports = { initBotHandlers, registerWebhook };
