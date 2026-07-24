'use strict';

/**
 * Smoke test — verifies the server boots cleanly:
 *   1. Loads .env and validates config
 *   2. Connects to MongoDB Atlas
 *   3. Requires all models (schema registration)
 *   4. Requires the Express app (middleware chain)
 *   5. Requires the bot module (handler registration skipped — no polling in test)
 *   6. Reports any import-time errors
 *
 * Does NOT start the HTTP server or the bot polling loop.
 * Safe to run without a Redis connection (Redis errors are non-fatal here).
 */

require('dotenv').config();

async function run() {
  console.log('\n🔍 Smoke test starting…\n');

  // ── 1. Config ─────────────────────────────────────────────────────────
  let config;
  try {
    config = require('../src/config/env');
    console.log('✅ Config validated');
  } catch (e) {
    console.error('❌ Config failed:', e.message);
    process.exit(1);
  }

  // ── 2. Logger ─────────────────────────────────────────────────────────
  const logger = require('../src/utils/logger');
  console.log('✅ Logger initialised');

  // ── 3. Models ─────────────────────────────────────────────────────────
  try {
    const models = require('../src/models');
    console.log(`✅ Models loaded: ${Object.keys(models).join(', ')}`);
  } catch (e) {
    console.error('❌ Models failed:', e.message);
    process.exit(1);
  }

  // ── 4. Express app ────────────────────────────────────────────────────
  try {
    const app = require('../src/app');
    console.log('✅ Express app created');
  } catch (e) {
    console.error('❌ Express app failed:', e.message);
    console.error(e.stack);
    process.exit(1);
  }

  // ── 5. MongoDB connection ─────────────────────────────────────────────
  try {
    const { connectDatabase, disconnect: disconnectDatabase } = require('../src/config/database');
    await connectDatabase();
    console.log('✅ MongoDB connected');

    const { AdminSettings } = require('../src/models');
    const settings = await AdminSettings.getSettings();
    console.log(`✅ AdminSettings loaded (${settings.personalities.length} personalities)`);

    await disconnectDatabase();
    console.log('✅ MongoDB disconnected cleanly');
  } catch (e) {
    console.error('❌ MongoDB failed:', e.message);
    process.exit(1);
  }

  // ── 6. Services ───────────────────────────────────────────────────────
  try {
    require('../src/services/userService');
    require('../src/services/bot/telegramService');
    require('../src/services/usage/usageService');
    console.log('✅ Services loaded');
  } catch (e) {
    console.error('❌ Services failed:', e.message);
    process.exit(1);
  }

  // ── 7. Bot handlers module ────────────────────────────────────────────
  try {
    require('../src/bot/index');
    require('../src/bot/commands/start');
    require('../src/bot/commands/help');
    require('../src/bot/commands/profile');
    require('../src/bot/commands/settings');
    require('../src/bot/commands/personality');
    require('../src/bot/commands/reset');
    require('../src/bot/handlers/callbackHandler');
    require('../src/bot/handlers/settingsCallbackHandler');
    require('../src/bot/handlers/personalityCallbackHandler');
    require('../src/bot/handlers/chatHandler');
    require('../src/services/ai/aiService');
    require('../src/services/ai/conversationService');
    require('../src/services/ai/promptBuilder');
    require('../src/services/ai/imageDetectionService');
    require('../src/bot/commands/usage');
    require('../src/bot/commands/images');
    require('../src/bot/commands/premium');
    require('../src/bot/commands/memory');
    require('../src/middleware/rateLimiter');
    require('../src/middleware/adminAuth');
    require('../src/services/image/imageService');
    require('../src/services/image/imagePromptBuilder');
    require('../src/jobs/imageQueue');
    require('../src/services/payment/paymentService');
    require('../src/bot/handlers/paymentCallbackHandler');
    require('../src/bot/handlers/memoryCallbackHandler');
    require('../src/jobs/subscriptionJob');
    require('../src/controllers/adminController');
    require('../src/routes/admin');
    console.log('✅ Bot modules + AI services loaded');
  } catch (e) {
    console.error('❌ Bot module failed:', e.message);
    console.error(e.stack);
    process.exit(1);
  }

  console.log('\n🎉 All smoke tests passed — project is in good shape!\n');
  process.exit(0);
}

run().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
