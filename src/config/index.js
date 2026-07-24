'use strict';

/**
 * Config barrel — re-exports everything from the config layer so consumers
 * can do:
 *
 *   const { config, connectDatabase, redisClient } = require('../config');
 *
 * instead of reaching into individual config files.
 */

const config = require('./env');
const { connectDatabase, disconnect: disconnectDatabase } = require('./database');
const { redisClient, bullRedis, disconnectRedis } = require('./redis');

module.exports = {
  config,
  connectDatabase,
  disconnectDatabase,
  redisClient,
  bullRedis,
  disconnectRedis,
};
