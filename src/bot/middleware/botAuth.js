'use strict';

/**
 * Bot Auth Middleware
 *
 * Runs before every message/command handler. Responsible for:
 *   1. Ignoring non-human updates (channels, edited messages, etc.)
 *   2. Extracting the Telegram user from the update
 *   3. Upserting the User document in MongoDB
 *   4. Checking maintenance mode
 *   5. Checking if the user is banned
 *   6. Lazily expiring premium subscriptions
 *   7. Attaching the user + chatId to the msg context
 *
 * Pattern: middleware functions receive (msg, next) and call next()
 * to continue, or return early to block processing.
 * We attach context to msg._ctx so handlers can access user data
 * without another DB round-trip.
 */

const { User } = require('../../models');
const { AdminSettings } = require('../../models');
const { sendMessage } = require('../../services/bot/telegramService');
const logger = require('../../utils/logger');

/**
 * Main bot auth middleware factory.
 * Returns a function that wraps any handler with auth checks.
 *
 * Usage:
 *   bot.on('message', withBotAuth(async (msg) => { ... }));
 *
 * @param {Function} handler  — the actual message handler
 * @param {object}   options
 * @param {boolean}  options.requirePremium  — reject free users
 * @param {boolean}  options.skipForAdmin    — skip ban/maintenance for admins
 */
function withBotAuth(handler, options = {}) {
  return async function (msg, match) {
    const chatId = msg.chat?.id;
    const from   = msg.from;

    // ── 1. Ignore non-human or forwarded-channel updates ──────────────────
    if (!from || from.is_bot) return;
    if (msg.chat?.type === 'channel') return;

    try {
      // ── 2. Upsert user ─────────────────────────────────────────────────
      const user = await User.upsertFromTelegram(from);

      // ── 3. Maintenance mode ────────────────────────────────────────────
      if (!user.isAdmin) {
        const settings = await AdminSettings.getSettings();
        if (settings.maintenanceMode) {
          await sendMessage(chatId, settings.maintenanceMessage);
          return;
        }
      }

      // ── 4. Ban check ───────────────────────────────────────────────────
      if (user.isBanned) {
        await sendMessage(
          chatId,
          '🚫 Your account has been suspended. Contact support if you believe this is an error.'
        );
        return;
      }

      // ── 5. Lazy premium expiry ─────────────────────────────────────────
      const expired = await user.checkAndExpirePremium();
      if (expired) {
        await sendMessage(
          chatId,
          `⏰ Your premium subscription has expired. Use /premium to renew and keep the magic going! ✨`
        );
      }

      // ── 6. Update last active timestamp ───────────────────────────────
      // Fire-and-forget — don't await, not critical path
      User.findByIdAndUpdate(user._id, {
        'stats.lastActiveAt': new Date(),
      }).exec().catch(() => {});

      // ── 7. Premium requirement check ──────────────────────────────────
      if (options.requirePremium && !user.isPremium) {
        await sendMessage(
          chatId,
          `⭐ This feature is available for premium members only.\n\nUse /premium to unlock unlimited conversations, more images, and exclusive personalities!`
        );
        return;
      }

      // ── 8. Attach context and call handler ────────────────────────────
      // _ctx is our convention for attaching middleware data to the msg object
      msg._ctx = { user, chatId };
      await handler(msg, match);

    } catch (err) {
      logger.error('botAuth middleware error', {
        chatId,
        telegramId: from?.id,
        error: err.message,
        stack: err.stack,
      });

      // Send a generic error only if we can identify a chatId
      if (chatId) {
        await sendMessage(
          chatId,
          '😔 Something went wrong on my end. Please try again in a moment!'
        ).catch(() => {});
      }
    }
  };
}

module.exports = { withBotAuth };
