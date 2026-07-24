'use strict';

/**
 * Admin Dashboard Routes
 *
 * All routes require authentication (requireAdminAuth middleware).
 * Login/logout are the only public routes.
 *
 * GET  /admin/login          — login page
 * POST /admin/login          — authenticate
 * POST /admin/logout         — destroy session
 * GET  /admin/               — overview dashboard
 * GET  /admin/users          — user list
 * POST /admin/users/ban      — ban a user
 * POST /admin/users/unban    — unban a user
 * GET  /admin/revenue        — revenue dashboard
 * GET  /admin/settings       — settings page
 * POST /admin/settings       — update settings
 * POST /admin/broadcast      — send message to all/filtered users
 */

const express         = require('express');
const { requireAdminAuth, createSession, destroySession } = require('../middleware/adminAuth');
const { adminLimiter } = require('../middleware/rateLimiter');
const adminController = require('../controllers/adminController');
const config          = require('../config/env');

const router = express.Router();

// Apply rate limiting to all admin routes
router.use(adminLimiter);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

router.get('/login', (req, res) => {
  if (req.cookies?.admin_session) return res.redirect('/admin');
  res.render('admin/login', { botName: config.bot.name, error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (
    username === config.admin.username &&
    password === config.admin.password
  ) {
    const token = await createSession();
    res.cookie('admin_session', token, {
      httpOnly: true,
      secure:   config.isProduction,
      sameSite: 'strict',
      maxAge:   8 * 60 * 60 * 1000, // 8 hours
    });
    return res.redirect('/admin');
  }

  return res.render('admin/login', {
    botName: config.bot.name,
    error:   'Invalid username or password',
  });
});

router.post('/logout', requireAdminAuth, async (req, res) => {
  await destroySession(req.cookies?.admin_session);
  res.clearCookie('admin_session');
  res.redirect('/admin/login');
});

// ---------------------------------------------------------------------------
// Protected routes — require auth
// ---------------------------------------------------------------------------

router.use(requireAdminAuth);

router.get('/',          adminController.getOverview);
router.get('/users',     adminController.getUsers);
router.post('/users/ban',   adminController.banUser);
router.post('/users/unban', adminController.unbanUser);
router.get('/revenue',   adminController.getRevenue);
router.get('/settings',  adminController.getSettings);
router.post('/settings', adminController.updateSettings);
router.post('/broadcast', adminController.broadcastMessage);

module.exports = router;
