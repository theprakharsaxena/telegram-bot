'use strict';

/**
 * Global Express Error Handler
 *
 * Must be registered LAST in app.js (after all routes).
 * Express identifies error-handling middleware by its 4-argument signature.
 *
 * Strategy:
 *   1. Normalise known error types (Mongoose, JWT, etc.) into AppError
 *   2. Log based on severity
 *   3. Send a safe, structured JSON response to the client
 *   4. Never leak stack traces or internal details in production
 */

const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const config = require('../config/env');

// ---------------------------------------------------------------------------
// Error normalisers
// Convert third-party errors into AppError instances so the handler below
// can treat everything uniformly.
// ---------------------------------------------------------------------------

function handleMongooseCastError(err) {
  return new AppError(`Invalid ${err.path}: ${err.value}`, 400);
}

function handleMongooseDuplicateKey(err) {
  const field = Object.keys(err.keyValue || {})[0] || 'field';
  return new AppError(`Duplicate value for ${field}. Please use another value.`, 409);
}

function handleMongooseValidationError(err) {
  const messages = Object.values(err.errors)
    .map((e) => e.message)
    .join('. ');
  return new AppError(`Validation failed: ${messages}`, 422);
}

function handleJWTError() {
  return new AppError('Invalid authentication token.', 401);
}

function handleJWTExpiredError() {
  return new AppError('Authentication token expired. Please log in again.', 401);
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendDevelopmentError(err, res) {
  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    stack: err.stack,
    error: err,
  });
}

function sendProductionError(err, res) {
  if (err.isOperational) {
    // Safe to expose — we created this error intentionally
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  } else {
    // Programmer error — never expose internals
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong. Please try again later.',
    });
  }
}

// ---------------------------------------------------------------------------
// Main error handler (4-argument signature required by Express)
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  // Default to 500 if statusCode not set
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Log every error with context
  const logPayload = {
    statusCode: err.statusCode,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id || null,
    telegramId: req.body?.message?.from?.id || null,
  };

  if (err.statusCode >= 500) {
    logger.error(err.message, { ...logPayload, stack: err.stack, meta: err.meta });
  } else {
    logger.warn(err.message, logPayload);
  }

  // ── Normalise known error types ──────────────────────────────────────────
  let error = err;

  if (err.name === 'CastError') error = handleMongooseCastError(err);
  if (err.code === 11000) error = handleMongooseDuplicateKey(err);
  if (err.name === 'ValidationError') error = handleMongooseValidationError(err);
  if (err.name === 'JsonWebTokenError') error = handleJWTError();
  if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();

  // ── Send response ─────────────────────────────────────────────────────────
  if (config.isDevelopment) {
    sendDevelopmentError(error, res);
  } else {
    sendProductionError(error, res);
  }
};
