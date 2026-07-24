'use strict';

const AppError = require('../utils/AppError');

/**
 * 404 catch-all middleware
 * Must be registered after all valid routes but before the error handler.
 */
module.exports = function notFound(req, res, next) {
  next(new AppError(`Cannot ${req.method} ${req.originalUrl}`, 404));
};
