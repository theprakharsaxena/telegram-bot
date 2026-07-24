'use strict';

/**
 * Launch Checklist — Pre-production Readiness Script
 *
 * Runs a comprehensive automated checklist verifying:
 *   - All environment variables are set (no placeholders)
 *   - All required modules load without errors
 *   - MongoDB connects and models register correctly
 *   - Redis connects
 *   - AdminSettings initialised with personalities
 *   - Security configuration is production-ready
 *   - No obvious misconfigurations
 *
 * Usage:
 *   node scripts/launch-checklist.js
 *
 * Exit code 0 = all checks passed
 * Exit code 1 = one or more checks failed
 */

require('dotenv').config();

let passed = 0;
let failed = 0;
let warnings = 0;

function ok(msg)   { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.error(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.warn(`  ⚠️  ${msg}`); warnings++; }
function section(title) { console.log(`\n── ${title} ${'─'.repeat(50 - title.length)}`); }

async function run() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   Telegram AI Companion — Launch Checklist           ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  // ── 1. Config validation ──────────────────────────────────────────────────
  section('1. Environment Configuration');

  let config;
  try {
    config = require('../src/config/env');
    ok('Config module loaded and validated');
  } catch (e) {
    fail(`Config validation failed: ${e.message}`);
    console.error('\nFix all config errors before continuing.\n');
    process.exit(1);
  }

  // Check no placeholder values remain
  const placeholders = ['FILL_IN', 'YOUR_', 'REPLACE_ME', 'xxx', 'placeholder'];
  const envChecks = {
    'TELEGRAM_BOT_TOKEN':      config.telegram.token,
    'NOVITA_API_KEY':          config.openai.apiKey,
    'REPLICATE_API_TOKEN':     config.replicate.apiToken,
    'ADMIN_SECRET_KEY':        config.admin.secretKey,
    'ADMIN_PASSWORD':          config.admin.password,
    'SESSION_SECRET':          config.session.secret,
    'TELEGRAM_WEBHOOK_SECRET': config.telegram.webhookSecret,
  };

  for (const [name, value] of Object.entries(envChecks)) {
    const isPlaceholder = placeholders.some(p =>
      value?.toLowerCase().includes(p.toLowerCase())
    );
    if (isPlaceholder || !value) {
      fail(`${name} appears to be a placeholder or is empty`);
    } else {
      ok(`${name} is set`);
    }
  }

  // Production-specific checks
  if (config.isProduction) {
    config.telegram.webhookUrl.startsWith('https://')
      ? ok('TELEGRAM_WEBHOOK_URL uses HTTPS')
      : fail('TELEGRAM_WEBHOOK_URL must use HTTPS in production');

    config.admin.password.length >= 12
      ? ok('ADMIN_PASSWORD meets minimum length')
      : fail('ADMIN_PASSWORD must be at least 12 characters');

    config.sentry.dsn
      ? ok('SENTRY_DSN is configured')
      : warn('SENTRY_DSN not set — errors won\'t be tracked in Sentry');

    config.env === 'production'
      ? ok('NODE_ENV=production')
      : fail('NODE_ENV must be "production"');
  } else {
    warn('Running in non-production mode — skipping some production checks');
  }

  // ── 2. Model loading ───────────────────────────────────────────────────────
  section('2. Mongoose Models');
  try {
    const models = require('../src/models');
    const modelNames = Object.keys(models);
    const expected = ['User','Conversation','Message','Memory','GeneratedImage',
                      'UsageTracking','Subscription','Payment','AdminSettings','Analytics'];
    expected.forEach(name => {
      modelNames.includes(name) ? ok(`${name} model loaded`) : fail(`${name} model missing`);
    });
  } catch (e) {
    fail(`Models failed to load: ${e.message}`);
  }

  // ── 3. Service modules ─────────────────────────────────────────────────────
  section('3. Service Modules');
  const services = [
    ['UserService',      '../src/services/userService'],
    ['UsageService',     '../src/services/usage/usageService'],
    ['AIService',        '../src/services/ai/aiService'],
    ['ConversationSvc',  '../src/services/ai/conversationService'],
    ['PromptBuilder',    '../src/services/ai/promptBuilder'],
    ['ImageService',     '../src/services/image/imageService'],
    ['PaymentService',   '../src/services/payment/paymentService'],
    ['TelegramService',  '../src/services/bot/telegramService'],
    ['Sanitizer',        '../src/utils/sanitizer'],
    ['SentryHelper',     '../src/utils/sentryHelper'],
  ];

  for (const [name, path] of services) {
    try {
      require(path);
      ok(`${name} loaded`);
    } catch (e) {
      fail(`${name} failed: ${e.message}`);
    }
  }

  // ── 4. Bot commands ────────────────────────────────────────────────────────
  section('4. Bot Commands & Handlers');
  const commands = [
    'start','help','profile','settings','personality',
    'reset','usage','images','premium','memory',
  ];
  for (const cmd of commands) {
    try {
      require(`../src/bot/commands/${cmd}`);
      ok(`/${cmd} command loaded`);
    } catch (e) {
      fail(`/${cmd} command failed: ${e.message}`);
    }
  }

  // ── 5. MongoDB connection ──────────────────────────────────────────────────
  section('5. MongoDB Connection');
  try {
    const { connectDatabase, disconnect } = require('../src/config/database');
    await connectDatabase();
    ok('MongoDB connected');

    const { AdminSettings } = require('../src/models');
    const settings = await AdminSettings.getSettings();
    ok(`AdminSettings loaded (${settings.personalities.length} personalities)`);

    const activePersonalities = settings.personalities.filter(p => p.isActive);
    activePersonalities.length > 0
      ? ok(`${activePersonalities.length} active personalities`)
      : fail('No active personalities configured');

    await disconnect();
    ok('MongoDB disconnected cleanly');
  } catch (e) {
    fail(`MongoDB error: ${e.message}`);
  }

  // ── 6. Redis connection ────────────────────────────────────────────────────
  section('6. Redis Connection');
  try {
    const { redisClient, bullRedis, disconnectRedis } = require('../src/config/redis');
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
      redisClient.ping().then(res => {
        clearTimeout(timeout);
        res === 'PONG' ? resolve() : reject(new Error(`unexpected: ${res}`));
      }).catch(reject);
    });
    ok('Redis main client connected');

    const bullPing = await bullRedis.ping();
    bullPing === 'PONG' ? ok('Redis BullMQ client connected') : fail('BullMQ Redis failed');

    await disconnectRedis();
    ok('Redis disconnected cleanly');
  } catch (e) {
    fail(`Redis error: ${e.message}`);
  }

  // ── 7. Security checks ─────────────────────────────────────────────────────
  section('7. Security Configuration');

  // Secret lengths
  config.admin.secretKey.length >= 32
    ? ok('ADMIN_SECRET_KEY is sufficiently long (≥32 chars)')
    : fail('ADMIN_SECRET_KEY must be at least 32 characters');

  config.session.secret.length >= 32
    ? ok('SESSION_SECRET is sufficiently long (≥32 chars)')
    : fail('SESSION_SECRET must be at least 32 characters');

  config.telegram.webhookSecret.length >= 16
    ? ok('TELEGRAM_WEBHOOK_SECRET is sufficiently long')
    : fail('TELEGRAM_WEBHOOK_SECRET must be at least 16 characters');

  // Validators loaded
  try {
    require('../src/validators/adminValidators');
    ok('Admin input validators loaded');
  } catch (e) {
    fail(`Admin validators failed: ${e.message}`);
  }

  // Rate limiter
  try {
    require('../src/middleware/rateLimiter');
    ok('Rate limiting middleware loaded');
  } catch (e) {
    fail(`Rate limiter failed: ${e.message}`);
  }

  // ── 8. Jobs ────────────────────────────────────────────────────────────────
  section('8. Background Jobs');
  try {
    require('../src/jobs/imageQueue');
    ok('Image generation queue loaded');
  } catch (e) {
    fail(`Image queue failed: ${e.message}`);
  }
  try {
    require('../src/jobs/subscriptionJob');
    ok('Subscription job loaded');
  } catch (e) {
    fail(`Subscription job failed: ${e.message}`);
  }

  // ── 9. Express app ─────────────────────────────────────────────────────────
  section('9. Express Application');
  try {
    const app = require('../src/app');
    ok('Express app factory loaded');

    // Check routes are registered by looking at the router stack
    const stack = app._router?.stack || [];
    const paths  = stack
      .filter(r => r.regexp)
      .map(r => r.regexp.toString().slice(0, 40));

    paths.some(p => p.includes('health')) ? ok('/health route registered') : warn('/health route not found in stack');
    paths.some(p => p.includes('webhook')) ? ok('/webhook route registered') : warn('/webhook route not found');
    paths.some(p => p.includes('admin')) ? ok('/admin route registered') : warn('/admin route not found');
  } catch (e) {
    fail(`Express app failed: ${e.message}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════╗');
  const total = passed + failed + warnings;
  if (failed === 0) {
    console.log(`║  ✅ ALL ${passed} CHECKS PASSED${warnings > 0 ? ` (${warnings} warnings)` : ''}${' '.repeat(Math.max(0, 28 - String(passed).length - (warnings > 0 ? String(warnings).length + 13 : 0)))}║`);
    console.log('║  Your bot is ready for production!                   ║');
  } else {
    console.log(`║  ❌ ${failed} CHECKS FAILED / ${passed} passed / ${warnings} warnings${' '.repeat(Math.max(0, 14 - String(failed).length - String(passed).length - String(warnings).length))}║`);
    console.log('║  Fix all ❌ items before going live.                  ║');
  }
  console.log('╚══════════════════════════════════════════════════════╝\n');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('\nUnexpected checklist error:', err.message);
  process.exit(1);
});
