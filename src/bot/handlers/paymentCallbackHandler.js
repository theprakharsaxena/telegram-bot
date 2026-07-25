'use strict';

/**
 * Payment Callback Handler
 *
 * Handles all callbacks with namespace 'payment':
 *   payment:weekly           — send weekly invoice
 *   payment:monthly          — send monthly invoice
 *   payment:cancel_confirm   — ask for cancellation confirmation
 *   payment:cancel_do        — execute cancellation
 *   payment:stars_info       — explain Telegram Stars to new users
 */

const { sendMessage, editMessage }  = require('../../services/bot/telegramService');
const paymentService                = require('../../services/payment/paymentService');
const { AdminSettings }             = require('../../models');
const logger                        = require('../../utils/logger');

async function handlePaymentCallback(action, query, ctx) {
  const { user, chatId } = ctx;
  const messageId = query.message?.message_id;

  // ── Send invoice ───────────────────────────────────────────────────────
  if (action === 'daily' || action === 'weekly' || action === 'monthly') {
    try {
      const settings = await AdminSettings.getSettings();
      await paymentService.createInvoice(user, action, settings);
      // Invoice appears in chat automatically — no extra message needed
    } catch (err) {
      logger.error('Invoice creation failed', {
        telegramId: user.telegramId,
        action,
        error: err.message,
      });
      await sendMessage(
        chatId,
        '😔 Could not create the payment. Please try again in a moment!'
      );
    }
    return;
  }

  // ── Stars info ─────────────────────────────────────────────────────────
  if (action === 'stars_info') {
    await sendMessage(
      chatId,
      `⭐ <b>What are Telegram Stars?</b>\n\n` +
      `Telegram Stars are the official in-app currency for Telegram.\n\n` +
      `<b>How to get Stars:</b>\n` +
      `1. Open Telegram Settings\n` +
      `2. Tap "Telegram Stars" or look in your wallet\n` +
      `3. Purchase Stars using Apple Pay, Google Pay, or card\n\n` +
      `Stars are secure, instant, and the safest way to pay inside Telegram. ` +
      `Your payment goes directly through Telegram's official payment system.\n\n` +
      `<i>Tap the plan buttons to start your premium subscription!</i>`
    );
    return;
  }

  // ── Cancel subscription — confirmation ─────────────────────────────────
  if (action === 'cancel_confirm') {
    await editMessage(
      chatId,
      messageId,
      `❌ <b>Cancel Subscription?</b>\n\n` +
      `You'll keep premium access until your current period ends.\n` +
      `Your subscription will not renew after that.\n\n` +
      `Are you sure you want to cancel?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Yes, cancel',  callback_data: 'payment:cancel_do' },
              { text: '← Keep premium', callback_data: 'payment:keep' },
            ],
          ],
        },
      }
    );
    return;
  }

  // ── Cancel subscription — execute ──────────────────────────────────────
  if (action === 'cancel_do') {
    try {
      const sub = await paymentService.cancelSubscription(
        user._id,
        'User requested via bot'
      );

      const expiryDate = new Date(sub.currentPeriodEnd).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

      await editMessage(
        chatId,
        messageId,
        `✅ <b>Subscription cancelled.</b>\n\n` +
        `You'll keep premium access until <b>${expiryDate}</b>.\n\n` +
        `We're sorry to see you go! If you change your mind, use /premium anytime. 💙`
      );
    } catch (err) {
      await sendMessage(chatId, '😔 Could not cancel subscription. Please try again.');
      logger.error('Subscription cancellation error', {
        userId: user._id,
        error:  err.message,
      });
    }
    return;
  }

  // ── Keep premium (dismiss cancel flow) ────────────────────────────────
  if (action === 'keep') {
    await editMessage(
      chatId,
      messageId,
      `💖 Great! Your premium subscription is still active. Enjoy! ⭐`
    );
    return;
  }

  logger.warn('Unknown payment action', { action, chatId });
}

module.exports = { handlePaymentCallback };
