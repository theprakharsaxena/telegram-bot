'use strict';

/**
 * MongoDB Connection Manager
 *
 * Handles connection lifecycle with:
 * - Exponential backoff retry on initial connect
 * - Automatic reconnection on drop (built into Mongoose)
 * - Graceful shutdown hooks
 * - Connection event logging
 */

const mongoose = require('mongoose');
const config = require('./env');

// Mongoose 7+ uses native promises; no need to set Promise explicitly.
// Disable buffering so operations fail fast when disconnected rather than
// silently queuing — makes bugs visible immediately in dev.
mongoose.set('bufferCommands', false);

const RETRY_DELAY_MS = 5000;
const MAX_RETRIES = 5;

/**
 * Attempt to connect to MongoDB with retry logic.
 * @param {number} attempt - current attempt number (1-based)
 */
async function connectWithRetry(attempt = 1) {
  const logger = require('../utils/logger'); // lazy import to avoid circular deps

  try {
    logger.info(`MongoDB connecting… (attempt ${attempt}/${MAX_RETRIES})`);

    await mongoose.connect(config.mongodb.uri, {
      // Keep connections lean — adjust based on load
      maxPoolSize: 10,
      minPoolSize: 2,
      // Time to wait for a socket before giving up
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      // Heartbeat keeps the connection alive through idle periods
      heartbeatFrequencyMS: 10000,
    });

    logger.info('MongoDB connected successfully');
  } catch (err) {
    logger.error(`MongoDB connection error: ${err.message}`);

    if (attempt < MAX_RETRIES) {
      logger.warn(`Retrying in ${RETRY_DELAY_MS / 1000}s…`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return connectWithRetry(attempt + 1);
    }

    // All retries exhausted — let the process crash so PM2 / systemd restarts it
    logger.error('MongoDB max retries reached. Exiting process.');
    process.exit(1);
  }
}

/**
 * Register Mongoose connection event listeners.
 * Called once during app bootstrap.
 */
function registerConnectionEvents() {
  const logger = require('../utils/logger');

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Mongoose will auto-reconnect.');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected.');
  });

  mongoose.connection.on('error', (err) => {
    logger.error(`MongoDB runtime error: ${err.message}`);
  });
}

/**
 * Gracefully close the MongoDB connection.
 * Called by the SIGTERM / SIGINT handler in server.js.
 */
async function disconnect() {
  const logger = require('../utils/logger');
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed gracefully.');
  } catch (err) {
    logger.error(`Error closing MongoDB connection: ${err.message}`);
  }
}

/**
 * Main export — call this during app startup.
 */
async function connectDatabase() {
  registerConnectionEvents();
  await connectWithRetry();
}

module.exports = { connectDatabase, disconnect };
