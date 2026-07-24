'use strict';

/**
 * Winston Logger
 *
 * Provides structured, leveled logging across the entire application.
 *
 * Transports:
 *   - Console     : human-readable colorized output in development,
 *                   JSON in production (easy to ingest into CloudWatch / Datadog)
 *   - Daily file  : rotating file per day, kept for 14 days, max 20 MB per file
 *   - Error file  : errors-only log for quick triage
 *
 * Usage:
 *   const logger = require('./utils/logger');
 *   logger.info('Server started', { port: 3000 });
 *   logger.error('Something broke', { error: err.message });
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config/env');

// ---------------------------------------------------------------------------
// Custom log format
// ---------------------------------------------------------------------------
const { combine, timestamp, errors, json, colorize, printf } = winston.format;

/** Human-readable format for development console output */
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
  })
);

/** Structured JSON format for production — easy to parse by log aggregators */
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
const transports = [];

// Console transport — always on
transports.push(
  new winston.transports.Console({
    format: config.isProduction ? prodFormat : devFormat,
    handleExceptions: true,
  })
);

// File transports — only in non-test environments
if (!config.isTest) {
  const logsDir = path.join(process.cwd(), 'logs');

  // Combined log (all levels)
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '14d',
      format: prodFormat,
      handleExceptions: true,
    })
  );

  // Errors-only log
  transports.push(
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',
      format: prodFormat,
      handleExceptions: true,
    })
  );
}

// ---------------------------------------------------------------------------
// Logger instance
// ---------------------------------------------------------------------------
const logger = winston.createLogger({
  level: config.logging.level,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// ---------------------------------------------------------------------------
// Stream interface for Morgan HTTP request logging
// ---------------------------------------------------------------------------
logger.stream = {
  write(message) {
    // Morgan appends a newline — trim it before handing off to Winston
    logger.http(message.trim());
  },
};

module.exports = logger;
