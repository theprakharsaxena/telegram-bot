'use strict';

/**
 * Redis Connection Manager
 *
 * Exports two shared IORedis instances:
 *   - `redisClient`  — general-purpose cache, session store, rate limit counters
 *   - `bullRedis`    — dedicated connection for BullMQ (separate to avoid
 *                      blocking commands interfering with cache reads)
 *
 * Both instances are singletons. Import and use them directly — no need to
 * call .connect() manually with ioredis.
 */

const Redis = require('ioredis');
const config = require('./env');

// ---------------------------------------------------------------------------
// Shared connection options
// ---------------------------------------------------------------------------
const baseOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  tls: config.redis.tls,
  // Retry strategy: exponential backoff capped at 30 s
  retryStrategy(times) {
    const delay = Math.min(times * 500, 30000);
    return delay;
  },
  // Do not crash on connection errors — ioredis will retry automatically
  enableOfflineQueue: true,
  // Prefix all keys with app namespace to avoid collisions on shared Redis
  keyPrefix: 'tgbot:',
  lazyConnect: false,
};

// ---------------------------------------------------------------------------
// General-purpose Redis client
// ---------------------------------------------------------------------------
const redisClient = new Redis({
  ...baseOptions,
  connectionName: 'tgbot-main',
  db: 0,
});

// ---------------------------------------------------------------------------
// BullMQ requires its own connection — it uses blocking commands (BLPOP etc.)
// that would starve a shared connection.
// ---------------------------------------------------------------------------
const bullRedis = new Redis({
  ...baseOptions,
  // BullMQ manages its own key namespacing — remove our global prefix here
  keyPrefix: '',
  connectionName: 'tgbot-bull',
  db: 0,
  // BullMQ recommendation: disable offline queue so jobs fail fast during
  // reconnection rather than queuing indefinitely
  enableOfflineQueue: false,
  maxRetriesPerRequest: null, // required by BullMQ
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------
function attachListeners(client, name) {
  // Lazy-require logger to avoid circular dependency at module load time
  const getLogger = () => require('../utils/logger');

  client.on('connect', () => getLogger().info(`Redis [${name}] connecting…`));
  client.on('ready', () => getLogger().info(`Redis [${name}] ready`));
  client.on('error', (err) =>
    getLogger().error(`Redis [${name}] error: ${err.message}`)
  );
  client.on('close', () => getLogger().warn(`Redis [${name}] connection closed`));
  client.on('reconnecting', () =>
    getLogger().warn(`Redis [${name}] reconnecting…`)
  );
}

attachListeners(redisClient, 'main');
attachListeners(bullRedis, 'bull');

// ---------------------------------------------------------------------------
// Graceful shutdown helper
// ---------------------------------------------------------------------------
async function disconnectRedis() {
  const logger = require('../utils/logger');
  try {
    await redisClient.quit();
    await bullRedis.quit();
    logger.info('Redis connections closed gracefully.');
  } catch (err) {
    logger.error(`Error closing Redis: ${err.message}`);
  }
}

module.exports = { redisClient, bullRedis, disconnectRedis };
