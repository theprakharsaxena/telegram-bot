'use strict';

/**
 * AppError — Custom operational error class
 *
 * Distinguishes between:
 *   - Operational errors  : expected failures (invalid input, 404, rate limit)
 *                           → logged at warn level, safe to send details to client
 *   - Programmer errors   : bugs (TypeError, ReferenceError, etc.)
 *                           → logged at error level, generic message to client
 *
 * Usage:
 *   throw new AppError('User not found', 404);
 *   throw new AppError('Limit exceeded', 429, { retryAfter: 60 });
 */
class AppError extends Error {
  /**
   * @param {string} message      - Human-readable error description
   * @param {number} statusCode   - HTTP status code
   * @param {object} [meta]       - Optional extra context (not sent to client)
   */
  constructor(message, statusCode = 500, meta = {}) {
    super(message);

    this.name = 'AppError';
    this.statusCode = statusCode;
    this.status = statusCode >= 500 ? 'error' : 'fail';
    this.isOperational = true; // flag used by error handler
    this.meta = meta;

    // Capture clean stack trace (excludes this constructor frame)
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
