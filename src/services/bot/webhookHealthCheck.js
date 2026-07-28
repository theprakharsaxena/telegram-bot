'use strict';

/**
 * Webhook Health Check Service
 *
 * Periodically verifies that the Telegram webhook is still registered correctly.
 * If the webhook becomes unregistered or points to the wrong URL, this service
 * automatically re-registers it to prevent bot downtime.
 *
 * Why this is needed:
 *   - Telegram may occasionally drop webhooks due to network issues
 *   - Server restarts without proper webhook registration can cause silent failures
 *   - Manual webhook changes by bot admins can break the integration
 *
 * Runs every 5 minutes in production only.
 */

const { getBot } = require('./telegramService');
const config = require('../../config/env');
const logger = require('../../utils/logger');

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let healthCheckTimer = null;

/**
 * Verify the current webhook configuration matches our expected settings.
 */
async function verifyWebhook() {
  if (!config.isProduction) {
    return; // Skip health checks in development (polling mode)
  }

  try {
    const bot = getBot();
    const webhookInfo = await bot.getWebHookInfo();

    const expectedUrl = `${config.telegram.webhookUrl}/webhook/${config.telegram.token}`;
    const currentUrl = webhookInfo.url;
    const hasSecret = webhookInfo.secret_token === config.telegram.webhookSecret;

    // Check if webhook is registered correctly
    if (!currentUrl || currentUrl !== expectedUrl || !hasSecret) {
      logger.warn('Webhook health check failed - re-registering', {
        expectedUrl,
        currentUrl,
        hasSecret,
      });

      // Re-register the webhook
      await bot.setWebHook(expectedUrl, {
        secret_token: config.telegram.webhookSecret,
        max_connections: 40,
        allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      });

      logger.info('Webhook re-registered successfully', { url: expectedUrl });
    } else {
      logger.debug('Webhook health check passed', { url: currentUrl });
    }
  } catch (err) {
    logger.error('Webhook health check error', { error: err.message });
    // Don't throw - let the next check retry
  }
}

/**
 * Start the periodic webhook health check.
 * Call this once during server startup in production.
 */
function startWebhookHealthCheck() {
  if (!config.isProduction) {
    logger.info('Webhook health check disabled (development mode)');
    return;
  }

  if (healthCheckTimer) {
    logger.warn('Webhook health check already running');
    return;
  }

  // Run initial check
  verifyWebhook().catch(() => {});

  // Schedule periodic checks
  healthCheckTimer = setInterval(verifyWebhook, HEALTH_CHECK_INTERVAL_MS);
  healthCheckTimer.unref(); // Don't block process exit

  logger.info('Webhook health check started (interval: 5 minutes)');
}

/**
 * Stop the webhook health check.
 * Call this during graceful shutdown.
 */
function stopWebhookHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    logger.info('Webhook health check stopped');
  }
}

module.exports = {
  startWebhookHealthCheck,
  stopWebhookHealthCheck,
  verifyWebhook,
};
