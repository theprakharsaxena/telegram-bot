'use strict';

/**
 * Health Check Routes
 *
 * GET /health        — quick liveness probe (load balancer / uptime monitors)
 * GET /health/ready  — readiness probe (checks DB + Redis before accepting traffic)
 *
 * AWS ALB, Nginx, and PM2 use /health for automated health checks.
 * The readiness endpoint is used during deployments to gate traffic switching.
 */

const express = require('express');
const mongoose = require('mongoose');
const { redisClient } = require('../config/redis');
const config = require('../config/env');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /health — liveness (is the process alive?)
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    environment: config.env,
    botName: config.bot.name,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    maintenanceMode: config.bot.maintenanceMode,
  });
});

// ---------------------------------------------------------------------------
// GET /health/ready — readiness (are all dependencies reachable?)
// ---------------------------------------------------------------------------
router.get('/ready', async (req, res) => {
  const checks = {
    mongodb: false,
    redis: false,
  };

  // MongoDB — readyState 1 = connected
  checks.mongodb = mongoose.connection.readyState === 1;

  // Redis — send a PING and expect PONG
  try {
    const pong = await redisClient.ping();
    checks.redis = pong === 'PONG';
  } catch {
    checks.redis = false;
  }

  const allReady = Object.values(checks).every(Boolean);
  const statusCode = allReady ? 200 : 503;

  res.status(statusCode).json({
    status: allReady ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
