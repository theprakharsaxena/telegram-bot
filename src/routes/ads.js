'use strict';

/**
 * Ads Route
 *
 * Serves the Telegram WebApp player for Adsgram rewarded video ads.
 * GET /ads/watch?userId=123456789
 */

const express = require('express');
const config = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/watch', (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).send('Missing userId parameter.');
  }

  const telegramId = parseInt(userId, 10);
  if (isNaN(telegramId)) {
    return res.status(400).send('Invalid userId parameter.');
  }

  try {
    res.render('ads/watch', {
      userId: telegramId,
      botName: config.bot.name,
      blockId: config.adsgram.adUnitId,
      bonusMessages: config.adsgram.bonusMessages,
      bonusImages: config.adsgram.bonusImages,
    });
  } catch (err) {
    logger.error('Error rendering ads/watch', { error: err.message, userId });
    res.status(500).send('Something went wrong. Please try again later.');
  }
});

module.exports = router;
