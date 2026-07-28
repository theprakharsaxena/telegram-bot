'use strict';

/**
 * Telegram Webhook Route
 *
 * POST /webhook/:token
 *
 * Security model:
 *   1. URL token check  — Telegram posts to a secret URL containing the bot
 *      token. Any request to a wrong URL gets 404 immediately.
 *   2. X-Telegram-Bot-Api-Secret-Token header — we set this when registering
 *      the webhook with Telegram. Every genuine update carries it.
 *      Requests without this header are rejected with 403.
 *   3. We always respond 200 quickly — if we return anything else Telegram
 *      will retry the update, causing duplicate processing.
 *
 * Flow:
 *   Telegram POST → signature check → bot.processUpdate(body) → 200 OK
 *   The actual message handling runs asynchronously inside processUpdate.
 */

const express = require('express');
const { getBot } = require('../services/bot/telegramService');
const config = require('../config/env');
const logger = require('../utils/logger');
const { User } = require('../models');

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /webhook/:token
// ---------------------------------------------------------------------------
router.post('/:token', (req, res) => {
  // ── 1. URL token check ────────────────────────────────────────────────
  // The token in the URL must match our bot token exactly.
  if (req.params.token !== config.telegram.token) {
    logger.warn('Webhook: invalid token in URL', {
      ip: req.ip,
      path: req.path,
    });
    return res.sendStatus(404);
  }

  // ── 2. Secret header check ────────────────────────────────────────────
  const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
  if (secretHeader !== config.telegram.webhookSecret) {
    logger.warn('Webhook: invalid or missing secret token header', {
      ip: req.ip,
      hasHeader: !!secretHeader,
    });
    return res.sendStatus(403);
  }

  // ── 3. Ack immediately — Telegram requires 200 within 5 seconds ───────
  res.sendStatus(200);

  // ── 4. Process update asynchronously ─────────────────────────────────
  // processUpdate() dispatches to the registered bot event handlers.
  // Errors inside handlers are caught by those handlers — we don't
  // surface them here to avoid crashing the webhook route.
  try {
    const bot = getBot();
    bot.processUpdate(req.body);
  } catch (err) {
    logger.error('Webhook: processUpdate threw synchronously', {
      error: err.message,
      update: JSON.stringify(req.body).slice(0, 200),
    });
  }
});

// ---------------------------------------------------------------------------
// GET /webhook/info  — development helper
// Returns the currently registered webhook URL from Telegram's API.
// Protected by admin key so it's not publicly readable.
// ---------------------------------------------------------------------------
router.get('/info', async (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== config.admin.secretKey) {
    return res.sendStatus(403);
  }

  try {
    const bot = getBot();
    const info = await bot.getWebHookInfo();
    res.json({ ok: true, webhookInfo: info });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /webhook/adsgram-reward — Adsgram rewarded ad callback
// Called by Adsgram when a user successfully watches a rewarded ad.
// The userId parameter contains the Telegram user ID.
// ---------------------------------------------------------------------------
router.get('/adsgram-reward', async (req, res) => {
  const { userid } = req.query;

  if (!userid || !config.adsgram.enabled) {
    logger.warn('Adsgram reward: invalid request or ads disabled', { userid });
    return res.status(400).json({ ok: false, error: 'Invalid request' });
  }

  const telegramId = parseInt(userid, 10);
  if (isNaN(telegramId)) {
    logger.warn('Adsgram reward: invalid userId format', { userid });
    return res.status(400).json({ ok: false, error: 'Invalid userId' });
  }

  try {
    const user = await User.findByTelegramId(telegramId);
    if (!user) {
      logger.warn('Adsgram reward: user not found', { telegramId });
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    // Only grant rewards to free users
    if (user.isPremium) {
      logger.info('Adsgram reward: premium user tried to watch ad', { telegramId });
      return res.json({ ok: true, message: 'Premium user - no reward needed' });
    }

    // Grant bonus messages and images
    user.adBonusMessages += config.adsgram.bonusMessages;
    user.adBonusImages += config.adsgram.bonusImages;
    user.lastAdWatchedAt = new Date();
    await user.save();

    logger.info('Adsgram reward granted', {
      telegramId,
      bonusMessages: config.adsgram.bonusMessages,
      bonusImages: config.adsgram.bonusImages,
    });

    res.json({ ok: true, message: 'Reward granted' });
  } catch (err) {
    logger.error('Adsgram reward error', { telegramId, error: err.message });
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
