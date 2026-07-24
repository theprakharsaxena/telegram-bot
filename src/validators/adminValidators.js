'use strict';

/**
 * Admin API Input Validators
 *
 * Joi schemas for every admin POST endpoint.
 * Applied as middleware before controllers run — controllers can trust
 * that req.body is already validated and typed correctly.
 */

const Joi = require('joi');

// ---------------------------------------------------------------------------
// Validation middleware factory
// ---------------------------------------------------------------------------

/**
 * Returns an Express middleware that validates req.body against a Joi schema.
 * On failure: returns 422 with a clear error message.
 * On success: replaces req.body with the sanitised, coerced value.
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly:   false,  // collect all errors
      stripUnknown: true,   // remove unknown fields (prevents mass assignment)
      convert:      true,   // coerce strings to numbers/booleans
    });

    if (error) {
      const messages = error.details.map((d) => d.message).join('; ');
      return res.status(422).json({
        status:  'fail',
        message: `Validation error: ${messages}`,
      });
    }

    req.body = value; // replace with sanitised value
    next();
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const banUserSchema = Joi.object({
  telegramId: Joi.number().integer().positive().required(),
  reason:     Joi.string().max(500).default('Admin action'),
});

const unbanUserSchema = Joi.object({
  telegramId: Joi.number().integer().positive().required(),
});

const updateSettingsSchema = Joi.object({
  maintenanceMode:        Joi.string().valid('true', 'false'),
  maintenanceMessage:     Joi.string().max(500),
  imageGenerationEnabled: Joi.string().valid('true', 'false'),
  memoryEnabled:          Joi.string().valid('true', 'false'),
  newUsersEnabled:        Joi.string().valid('true', 'false'),
  freeDailyMessages:      Joi.number().integer().min(1).max(10000),
  freeDailyImages:        Joi.number().integer().min(0).max(1000),
  freeMemoryLimit:        Joi.number().integer().min(0).max(1000),
  premiumDailyMessages:   Joi.number().integer().min(1).max(100000),
  premiumDailyImages:     Joi.number().integer().min(0).max(10000),
  premiumMemoryLimit:     Joi.number().integer().min(0).max(10000),
  starsWeeklyPrice:       Joi.number().integer().min(1).max(100000),
  starsMonthlyPrice:      Joi.number().integer().min(1).max(100000),
  aiModel:                Joi.string().valid('gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'),
  aiTemperature:          Joi.number().min(0).max(2),
  aiMaxTokens:            Joi.number().integer().min(100).max(4096),
  contextWindowSize:      Joi.number().integer().min(5).max(50),
  summaryThreshold:       Joi.number().integer().min(10).max(200),
});

const broadcastSchema = Joi.object({
  message:    Joi.string().min(1).max(4096).required(),
  planFilter: Joi.string().valid('', 'free', 'premium').default(''),
});

// ---------------------------------------------------------------------------
// Exports — each is a ready-to-use middleware
// ---------------------------------------------------------------------------
module.exports = {
  validateBanUser:       validate(banUserSchema),
  validateUnbanUser:     validate(unbanUserSchema),
  validateUpdateSettings: validate(updateSettingsSchema),
  validateBroadcast:     validate(broadcastSchema),
};
