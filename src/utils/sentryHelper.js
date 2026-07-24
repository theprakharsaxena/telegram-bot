'use strict';

/**
 * Sentry Helper
 *
 * Provides structured error capture with consistent context.
 * All application code should use these helpers instead of calling
 * Sentry directly — makes it easy to swap error monitoring tools later.
 *
 * If SENTRY_DSN is not configured, all calls are no-ops.
 */

const Sentry = require('@sentry/node');
const config = require('../config/env');

const isSentryEnabled = !!config.sentry.dsn;

/**
 * Capture an exception with additional context.
 * Use for unexpected errors that need investigation.
 *
 * @param {Error}  error
 * @param {object} context — extra key/value pairs added to the Sentry event
 */
function captureError(error, context = {}) {
  if (!isSentryEnabled) return;

  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureException(error);
  });
}

/**
 * Capture a message (non-error event) at a given severity level.
 * Use for important business events: payment failures, limit violations, etc.
 *
 * @param {string} message
 * @param {'info'|'warning'|'error'} level
 * @param {object} context
 */
function captureMessage(message, level = 'info', context = {}) {
  if (!isSentryEnabled) return;

  Sentry.withScope((scope) => {
    scope.setLevel(level);
    Object.entries(context).forEach(([key, value]) => {
      scope.setExtra(key, value);
    });
    Sentry.captureMessage(message);
  });
}

/**
 * Set user context for the current Sentry scope.
 * Call this when you know the user's identity.
 *
 * @param {object} user — User document
 */
function setUser(user) {
  if (!isSentryEnabled) return;
  Sentry.setUser({
    id:       user._id?.toString(),
    username: user.username || user.telegramId?.toString(),
  });
}

/**
 * Clear user context (e.g. after request ends).
 */
function clearUser() {
  if (!isSentryEnabled) return;
  Sentry.setUser(null);
}

/**
 * Test Sentry connectivity — sends a test event.
 * Call from a one-off script to verify DSN is working.
 */
async function testSentry() {
  if (!isSentryEnabled) {
    console.log('Sentry is not configured (SENTRY_DSN is empty). Skipping test.');
    return;
  }

  try {
    Sentry.captureMessage('Sentry test event from telegram-ai-companion', 'info');
    await Sentry.flush(2000);
    console.log('✅ Sentry test event sent. Check your Sentry dashboard.');
  } catch (err) {
    console.error('❌ Sentry test failed:', err.message);
  }
}

module.exports = { captureError, captureMessage, setUser, clearUser, testSentry };
