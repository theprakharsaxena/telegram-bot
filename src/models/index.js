'use strict';

/**
 * Models barrel export
 *
 * Import any model from a single location:
 *   const { User, Message, Conversation } = require('../models');
 *
 * All models are registered with Mongoose on first require, so importing
 * this barrel in server.js ensures all schemas are known before any
 * query runs — important for population (.populate()) to work correctly.
 */

const User           = require('./User');
const Conversation   = require('./Conversation');
const Message        = require('./Message');
const Memory         = require('./Memory');
const GeneratedImage = require('./GeneratedImage');
const UsageTracking  = require('./UsageTracking');
const Subscription   = require('./Subscription');
const Payment        = require('./Payment');
const AdminSettings  = require('./AdminSettings');
const Analytics      = require('./Analytics');

module.exports = {
  User,
  Conversation,
  Message,
  Memory,
  GeneratedImage,
  UsageTracking,
  Subscription,
  Payment,
  AdminSettings,
  Analytics,
};
