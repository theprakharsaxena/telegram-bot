'use strict';

/**
 * Server Entry Point
 *
 * Responsibilities:
 *   1. Load environment variables FIRST (before any other import)
 *   2. Initialise Sentry (needs to wrap the entire process)
 *   3. Connect to MongoDB and Redis
 *   4. Start the Express HTTP server
 *   5. Register graceful shutdown handlers for SIGTERM / SIGINT
 *
 * This file is intentionally thin — all app logic lives in src/app.js.
 * That separation keeps the app testable without binding to a real port.
 */

// ── Step 1: Load .env before any config module runs ───────────────────────
require('dotenv').config();

// ── Step 2: Import config (validates env vars — crashes fast if invalid) ───
const config = require('./src/config/env');
const logger  = require('./src/utils/logger');

// ── Step 3: Unhandled rejection / exception safety net ────────────────────
// These catch bugs that escape try/catch — log them and exit so PM2 restarts.
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION — shutting down', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION — shutting down', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

// ── Step 4: Import DB / cache connectors and Express app ──────────────────
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const { disconnectRedis }                     = require('./src/config/redis');
const app                                     = require('./src/app');
const { initBotHandlers }                     = require('./src/bot');
const { startImageWorker, closeImageQueue }   = require('./src/jobs/imageQueue');
const { startSubscriptionJob }                = require('./src/jobs/subscriptionJob');

// Register all Mongoose models before any query runs
require('./src/models');

// ── Step 5: Boot sequence ──────────────────────────────────────────────────
async function start() {
  try {
    logger.info(`Starting ${config.bot.name} bot server…`, {
      env: config.env,
      node: process.version,
    });

    // Connect to MongoDB (retries internally up to 5 times)
    await connectDatabase();

    // Redis connects eagerly on import — just log confirmation here
    logger.info('Redis clients initialised');

    // Initialise Telegram bot and register all handlers
    await initBotHandlers();

    // Start BullMQ image generation worker
    startImageWorker();

    // Start subscription expiry + renewal reminder job (runs hourly)
    startSubscriptionJob();

    // Start HTTP server
    const server = app.listen(config.port, () => {
      logger.info(`HTTP server listening on port ${config.port}`);
    });

    // ── Graceful shutdown ────────────────────────────────────────────────
    // PM2 sends SIGINT on graceful reload; Linux systemd sends SIGTERM.
    // We stop accepting new connections, wait for in-flight requests to
    // finish (30 s max), then close DB/cache connections cleanly.

    const shutdown = async (signal) => {
      logger.warn(`${signal} received — starting graceful shutdown`);

      server.close(async () => {
        logger.info('HTTP server closed (no new connections)');

        try {
          await disconnectDatabase();
          await disconnectRedis();
          await closeImageQueue();
          logger.info('All connections closed. Goodbye.');
          process.exit(0);
        } catch (err) {
          logger.error('Error during shutdown cleanup', { error: err.message });
          process.exit(1);
        }
      });

      // Force-exit if graceful shutdown takes longer than 30 s
      setTimeout(() => {
        logger.error('Graceful shutdown timed out — forcing exit');
        process.exit(1);
      }, 30_000).unref(); // .unref() so this timer doesn't keep the loop alive
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    logger.error('Fatal error during startup', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }
}

start();
