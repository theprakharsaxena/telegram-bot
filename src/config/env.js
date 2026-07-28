'use strict';

/**
 * Environment Configuration & Validation
 *
 * This module is the single source of truth for all environment variables.
 * It validates every required variable at startup and throws a descriptive
 * error if anything is missing — preventing silent misconfigurations in
 * production. All other modules import from here, never from process.env directly.
 */

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Validation Schema
// Define every variable the app depends on, with types and defaults.
// ---------------------------------------------------------------------------
const envSchema = Joi.object({
  // ── Runtime ───────────────────────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),

  // ── MongoDB ───────────────────────────────────────────────────────────────
  MONGODB_URI: Joi.string().uri().required(),

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_HOST: Joi.string().default('127.0.0.1'),
  REDIS_PORT: Joi.number().integer().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_TLS: Joi.boolean().default(false),

  // ── Telegram ──────────────────────────────────────────────────────────────
  TELEGRAM_BOT_TOKEN: Joi.string().required(),
  TELEGRAM_WEBHOOK_SECRET: Joi.string().min(16).required(),
  TELEGRAM_WEBHOOK_URL: Joi.string().uri().required(),

  // ── Novita AI (Chat) ──────────────────────────────────────────────────────
  // Novita uses the OpenAI-compatible API — same SDK, different baseURL + model
  NOVITA_API_KEY: Joi.string().required(),
  NOVITA_BASE_URL: Joi.string().uri().default('https://api.novita.ai/openai'),
  NOVITA_MODEL: Joi.string().default('meta-llama/llama-3.1-8b-instruct'),
  NOVITA_MAX_TOKENS: Joi.number().integer().default(2048),
  NOVITA_TEMPERATURE: Joi.number().min(0).max(2).default(1),

  // ── Fal AI & Runware AI (Image Generation) ────────────────────────────────
  FAL_KEY: Joi.string().required(),
  RUNWARE_API_KEY: Joi.string().required(),

  // ── Sentry ────────────────────────────────────────────────────────────────
  SENTRY_DSN: Joi.string().uri().allow('').default(''),

  // ── Admin ─────────────────────────────────────────────────────────────────
  ADMIN_SECRET_KEY: Joi.string().min(32).required(),
  ADMIN_USERNAME: Joi.string().default('admin'),
  ADMIN_PASSWORD: Joi.string().min(12).required(),

  // ── Free Plan Limits ──────────────────────────────────────────────────────
  FREE_DAILY_MESSAGES: Joi.number().integer().default(20),
  FREE_DAILY_IMAGES: Joi.number().integer().default(3),
  FREE_MEMORY_LIMIT: Joi.number().integer().default(20),

  // ── Premium Plan Limits ───────────────────────────────────────────────────
  PREMIUM_DAILY_MESSAGES: Joi.number().integer().default(999999),
  PREMIUM_DAILY_IMAGES: Joi.number().integer().default(30),
  PREMIUM_MEMORY_LIMIT: Joi.number().integer().default(200),

  // ── Telegram Stars Pricing ────────────────────────────────────────────────
  STARS_DAILY_PRICE: Joi.number().integer().default(9),
  STARS_WEEKLY_PRICE: Joi.number().integer().default(49),
  STARS_MONTHLY_PRICE: Joi.number().integer().default(149),

  // ── Session / Security ────────────────────────────────────────────────────
  SESSION_SECRET: Joi.string().min(32).required(),

  // ── App Behaviour ─────────────────────────────────────────────────────────
  BOT_NAME: Joi.string().default('Luna'),
  MAINTENANCE_MODE: Joi.boolean().default(false),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),

  // ── Adsgram Rewarded Ads ───────────────────────────────────────────────────
  ADSGRAM_ENABLED: Joi.boolean().default(false),
  ADSGRAM_BOT_ID: Joi.string().allow('').default(''),
  ADSGRAM_AD_UNIT_ID: Joi.string().allow('').default(''),
  ADSGRAM_BONUS_MESSAGES: Joi.number().integer().default(20),
  ADSGRAM_BONUS_IMAGES: Joi.number().integer().default(3),
})
  // Allow unknown keys so third-party tools can add env vars without breaking
  // our validation. We only assert what we care about.
  .unknown(true);

// ---------------------------------------------------------------------------
// Run Validation
// ---------------------------------------------------------------------------
const { value: envVars, error } = envSchema.validate(process.env, {
  abortEarly: false, // collect ALL errors, not just the first
  convert: true,     // coerce strings → numbers/booleans automatically
});

if (error) {
  const missing = error.details.map((d) => `  ✗ ${d.message}`).join('\n');
  throw new Error(
    `\n\n🚨 Environment configuration is invalid. Fix the following before starting:\n\n${missing}\n\n` +
      `Copy .env.example to .env and fill in every required value.\n`
  );
}

// ---------------------------------------------------------------------------
// Export typed config object
// All modules import from here — never from process.env directly.
// ---------------------------------------------------------------------------
const config = {
  env: envVars.NODE_ENV,
  isProduction: envVars.NODE_ENV === 'production',
  isDevelopment: envVars.NODE_ENV === 'development',
  isTest: envVars.NODE_ENV === 'test',
  port: envVars.PORT,

  mongodb: {
    uri: envVars.MONGODB_URI,
  },

  redis: {
    host: envVars.REDIS_HOST,
    port: envVars.REDIS_PORT,
    password: envVars.REDIS_PASSWORD || undefined,
    tls: envVars.REDIS_TLS ? {} : undefined,
  },

  telegram: {
    token: envVars.TELEGRAM_BOT_TOKEN,
    webhookSecret: envVars.TELEGRAM_WEBHOOK_SECRET,
    webhookUrl: envVars.TELEGRAM_WEBHOOK_URL,
  },

  openai: {
    // Kept as alias so AdminSettings aiModel field still works
    apiKey:      envVars.NOVITA_API_KEY,
    baseURL:     envVars.NOVITA_BASE_URL,
    model:       envVars.NOVITA_MODEL,
    maxTokens:   envVars.NOVITA_MAX_TOKENS,
    temperature: envVars.NOVITA_TEMPERATURE,
  },

  imageGen: {
    falKey: envVars.FAL_KEY,
    runwareApiKey: envVars.RUNWARE_API_KEY,
  },

  sentry: {
    dsn: envVars.SENTRY_DSN || null,
  },

  admin: {
    secretKey: envVars.ADMIN_SECRET_KEY,
    username: envVars.ADMIN_USERNAME,
    password: envVars.ADMIN_PASSWORD,
  },

  limits: {
    free: {
      dailyMessages: envVars.FREE_DAILY_MESSAGES,
      dailyImages: envVars.FREE_DAILY_IMAGES,
      memoryLimit: envVars.FREE_MEMORY_LIMIT,
    },
    premium: {
      dailyMessages: envVars.PREMIUM_DAILY_MESSAGES,
      dailyImages: envVars.PREMIUM_DAILY_IMAGES,
      memoryLimit: envVars.PREMIUM_MEMORY_LIMIT,
    },
  },

  stars: {
    dailyPrice: envVars.STARS_DAILY_PRICE,
    weeklyPrice: envVars.STARS_WEEKLY_PRICE,
    monthlyPrice: envVars.STARS_MONTHLY_PRICE,
  },

  session: {
    secret: envVars.SESSION_SECRET,
  },

  bot: {
    name: envVars.BOT_NAME,
    maintenanceMode: envVars.MAINTENANCE_MODE,
  },

  logging: {
    level: envVars.LOG_LEVEL,
  },

  adsgram: {
    enabled: envVars.ADSGRAM_ENABLED,
    botId: envVars.ADSGRAM_BOT_ID,
    adUnitId: envVars.ADSGRAM_AD_UNIT_ID,
    bonusMessages: envVars.ADSGRAM_BONUS_MESSAGES,
    bonusImages: envVars.ADSGRAM_BONUS_IMAGES,
  },
};

module.exports = config;
