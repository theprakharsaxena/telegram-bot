'use strict';

/**
 * Express Application Factory
 *
 * Builds and configures the Express app without starting the server.
 * Keeping app creation separate from server.listen() makes the app
 * cleanly testable with Supertest (no real port needed in tests).
 *
 * Middleware order:
 *   1. Sentry (must be first)
 *   2. Security headers (Helmet)
 *   3. Cookie parser
 *   4. Body parsers
 *   5. Compression
 *   6. CORS
 *   7. HTTP request logging
 *   8. Rate limiting
 *   9. Template engine + static files
 *  10. Routes
 *  11. Sentry error handler
 *  12. 404 catch-all
 *  13. Global error handler
 */

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const morgan      = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path        = require('path');
const Sentry      = require('@sentry/node');

const config        = require('./config/env');
const logger        = require('./utils/logger');
const notFound      = require('./middleware/notFound');
const errorHandler  = require('./middleware/errorHandler');
const healthRouter  = require('./routes/health');

const app = express();

// ---------------------------------------------------------------------------
// 1. Sentry
// @sentry/node v8 removed autoDiscoverNodePerformanceMonitoringIntegrations
// and Handlers.requestHandler/tracingHandler/errorHandler.
// The v8 API uses Sentry.setupExpressErrorHandler() instead.
// We guard against both API versions for compatibility.
// ---------------------------------------------------------------------------
if (config.sentry.dsn) {
  try {
    Sentry.init({
      dsn:              config.sentry.dsn,
      environment:      config.env,
      tracesSampleRate: config.isProduction ? 0.1 : 1.0,
    });

    // v7 API: requestHandler + tracingHandler (may not exist in v8)
    if (typeof Sentry.Handlers?.requestHandler === 'function') {
      app.use(Sentry.Handlers.requestHandler());
    }
    if (typeof Sentry.Handlers?.tracingHandler === 'function') {
      app.use(Sentry.Handlers.tracingHandler());
    }

    logger.info('Sentry initialised');
  } catch (sentryErr) {
    // Never let Sentry initialisation crash the app
    logger.warn('Sentry initialisation failed — continuing without it', {
      error: sentryErr.message,
    });
  }
}

// ---------------------------------------------------------------------------
// 2. Security headers
// ---------------------------------------------------------------------------
app.use(
  helmet({
    contentSecurityPolicy: config.isProduction ? undefined : false,
  })
);

// ---------------------------------------------------------------------------
// 3. Cookie parser (required for admin session cookies)
// ---------------------------------------------------------------------------
app.use(cookieParser());

// ---------------------------------------------------------------------------
// 4. Body parsers
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ---------------------------------------------------------------------------
// 5. Response compression
// ---------------------------------------------------------------------------
app.use(compression());

// ---------------------------------------------------------------------------
// 6. CORS
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin:         config.isProduction ? false : '*',
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
  })
);

// ---------------------------------------------------------------------------
// 7. HTTP request logging
// ---------------------------------------------------------------------------
app.use(
  morgan(config.isProduction ? 'combined' : 'dev', {
    stream: logger.stream,
    skip:   (req) => req.path === '/health',
  })
);

// ---------------------------------------------------------------------------
// 8. Rate limiting
// ---------------------------------------------------------------------------
const { generalLimiter, webhookLimiter } = require('./middleware/rateLimiter');
app.use(generalLimiter);

// ---------------------------------------------------------------------------
// 9. Template engine + static files
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------------------
// 10. Routes
// ---------------------------------------------------------------------------

// Health probes
app.use('/health', healthRouter);

// Telegram webhook
const webhookRouter = require('./routes/webhook');
app.use('/webhook', webhookLimiter, webhookRouter);

// Admin dashboard
const adminRouter = require('./routes/admin');
app.use('/admin', adminRouter);

// ---------------------------------------------------------------------------
// 11. Sentry error handler
// ---------------------------------------------------------------------------
if (config.sentry.dsn) {
  // v8 API
  if (typeof Sentry.setupExpressErrorHandler === 'function') {
    Sentry.setupExpressErrorHandler(app);
  // v7 API
  } else if (typeof Sentry.Handlers?.errorHandler === 'function') {
    app.use(Sentry.Handlers.errorHandler());
  }
}

// ---------------------------------------------------------------------------
// 12. 404 catch-all
// ---------------------------------------------------------------------------
app.use(notFound);

// ---------------------------------------------------------------------------
// 13. Global error handler
// ---------------------------------------------------------------------------
app.use(errorHandler);

module.exports = app;
