'use strict';

/**
 * Admin Controller
 *
 * Business logic for every admin dashboard section.
 * Routes are thin — all queries and logic live here.
 */

const {
  User, Analytics, Payment, Subscription,
  GeneratedImage, AdminSettings, Message,
} = require('../models');
const { getQueueStats }    = require('../jobs/imageQueue');
const userService          = require('../services/userService');
const config               = require('../config/env');
const logger               = require('../utils/logger');

// ---------------------------------------------------------------------------
// Overview / Dashboard
// ---------------------------------------------------------------------------

async function getOverview(req, res) {
  try {
    const today     = new Date().toISOString().slice(0, 10);
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      return d.toISOString().slice(0, 10);
    }).reverse();

    // Run all queries in parallel
    const [
      totalUsers,
      premiumUsers,
      todayAnalytics,
      weekAnalytics,
      recentPayments,
      queueStats,
    ] = await Promise.all([
      User.countDocuments({ isDeleted: false }),
      User.countDocuments({ plan: 'premium', isDeleted: false }),
      Analytics.findOne({ date: today }).lean(),
      Analytics.find({ date: { $in: last7Days } }).sort({ date: 1 }).lean(),
      Payment.find({ status: 'completed' })
        .sort({ completedAt: -1 })
        .limit(5)
        .lean(),
      getQueueStats().catch(() => ({ waiting: 0, active: 0, completed: 0, failed: 0 })),
    ]);

    // 7-day totals
    const weekTotals = weekAnalytics.reduce((acc, day) => ({
      messages:  acc.messages  + (day.totalMessages || 0),
      images:    acc.images    + (day.totalImagesGenerated || 0),
      newUsers:  acc.newUsers  + (day.newUsers || 0),
      revenue:   acc.revenue   + (day.totalStarsEarned || 0),
    }), { messages: 0, images: 0, newUsers: 0, revenue: 0 });

    const data = {
      page:         'overview',
      botName:      config.bot.name,
      totalUsers,
      premiumUsers,
      freeUsers:    totalUsers - premiumUsers,
      today:        todayAnalytics || {},
      weekTotals,
      weekAnalytics,
      recentPayments,
      queueStats,
      maintenanceMode: config.bot.maintenanceMode,
    };

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'ok', data });
    }
    return res.render('admin/overview', data);
  } catch (err) {
    logger.error('Admin overview error', { error: err.message });
    return res.status(500).render('admin/error', { message: err.message });
  }
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

async function getUsers(req, res) {
  try {
    const page     = parseInt(req.query.page) || 1;
    const limit    = 20;
    const skip     = (page - 1) * limit;
    const search   = req.query.search?.trim() || '';
    const planFilter = req.query.plan || '';

    const query = { isDeleted: false };
    if (planFilter) query.plan = planFilter;
    if (search) {
      const num = parseInt(search);
      query.$or = [
        { firstName:  { $regex: search, $options: 'i' } },
        { username:   { $regex: search, $options: 'i' } },
        ...(isNaN(num) ? [] : [{ telegramId: num }]),
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);

    const data = {
      page:     'users',
      botName:  config.bot.name,
      users,
      total,
      currentPage: page,
      totalPages:  Math.ceil(total / limit),
      search,
      planFilter,
    };

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'ok', data });
    }
    return res.render('admin/users', data);
  } catch (err) {
    logger.error('Admin users error', { error: err.message });
    return res.status(500).render('admin/error', { message: err.message });
  }
}

async function banUser(req, res) {
  try {
    const { telegramId, reason } = req.body;
    await userService.banUser(parseInt(telegramId), reason || 'Admin action');
    return res.json({ status: 'ok', message: 'User banned' });
  } catch (err) {
    return res.status(400).json({ status: 'fail', message: err.message });
  }
}

async function unbanUser(req, res) {
  try {
    const { telegramId } = req.body;
    await userService.unbanUser(parseInt(telegramId));
    return res.json({ status: 'ok', message: 'User unbanned' });
  } catch (err) {
    return res.status(400).json({ status: 'fail', message: err.message });
  }
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

async function getRevenue(req, res) {
  try {
    const days      = parseInt(req.query.days) || 30;
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    const startStr  = startDate.toISOString().slice(0, 10);
    const today     = new Date().toISOString().slice(0, 10);

    const [analytics, totalRevResult, recentPayments, activeSubs] = await Promise.all([
      Analytics.getRange(startStr, today),
      Payment.getTotalRevenue(startDate, new Date()),
      Payment.find({ status: 'completed' })
        .sort({ completedAt: -1 })
        .limit(20)
        .populate('userId', 'firstName username telegramId')
        .lean(),
      Subscription.countDocuments({ status: 'active', currentPeriodEnd: { $gt: new Date() } }),
    ]);

    const totalStars  = totalRevResult[0]?.totalStars || 0;
    const totalPayments = totalRevResult[0]?.count || 0;

    const data = {
      page:   'revenue',
      botName: config.bot.name,
      analytics,
      totalStars,
      totalPayments,
      activeSubs,
      recentPayments,
      days,
    };

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'ok', data });
    }
    return res.render('admin/revenue', data);
  } catch (err) {
    logger.error('Admin revenue error', { error: err.message });
    return res.status(500).render('admin/error', { message: err.message });
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings(req, res) {
  try {
    const settings = await AdminSettings.getSettings();
    const data = {
      page:     'settings',
      botName:  config.bot.name,
      settings,
      envConfig: {
        freeDailyMessages:    config.limits.free.dailyMessages,
        freeDailyImages:      config.limits.free.dailyImages,
        premiumDailyMessages: config.limits.premium.dailyMessages,
        premiumDailyImages:   config.limits.premium.dailyImages,
      },
    };

    if (req.headers.accept?.includes('application/json')) {
      return res.json({ status: 'ok', data: settings });
    }
    return res.render('admin/settings', data);
  } catch (err) {
    return res.status(500).render('admin/error', { message: err.message });
  }
}

async function updateSettings(req, res) {
  try {
    const {
      maintenanceMode, maintenanceMessage,
      imageGenerationEnabled, memoryEnabled, newUsersEnabled,
      freeDailyMessages, freeDailyImages, freeMemoryLimit,
      premiumDailyMessages, premiumDailyImages, premiumMemoryLimit,
      starsDailyPrice, starsWeeklyPrice, starsMonthlyPrice,
      aiModel, aiTemperature, aiMaxTokens,
      summaryThreshold, contextWindowSize,
    } = req.body;

    const settings = await AdminSettings.getSettings();

    // Apply updates
    if (maintenanceMode !== undefined)      settings.maintenanceMode      = maintenanceMode === 'true';
    if (maintenanceMessage)                 settings.maintenanceMessage   = maintenanceMessage;
    if (imageGenerationEnabled !== undefined) settings.imageGenerationEnabled = imageGenerationEnabled === 'true';
    if (memoryEnabled !== undefined)        settings.memoryEnabled        = memoryEnabled === 'true';
    if (newUsersEnabled !== undefined)      settings.newUsersEnabled      = newUsersEnabled === 'true';

    if (freeDailyMessages)  settings.freeLimits.dailyMessages    = parseInt(freeDailyMessages);
    if (freeDailyImages)    settings.freeLimits.dailyImages      = parseInt(freeDailyImages);
    if (freeMemoryLimit)    settings.freeLimits.memoryLimit      = parseInt(freeMemoryLimit);
    if (premiumDailyMessages) settings.premiumLimits.dailyMessages = parseInt(premiumDailyMessages);
    if (premiumDailyImages)   settings.premiumLimits.dailyImages   = parseInt(premiumDailyImages);
    if (premiumMemoryLimit)   settings.premiumLimits.memoryLimit   = parseInt(premiumMemoryLimit);

    if (starsDailyPrice)    settings.starsDailyPrice   = parseInt(starsDailyPrice);
    if (starsWeeklyPrice)   settings.starsWeeklyPrice  = parseInt(starsWeeklyPrice);
    if (starsMonthlyPrice)  settings.starsMonthlyPrice = parseInt(starsMonthlyPrice);

    if (aiModel)            settings.aiModel            = aiModel;
    if (aiTemperature)      settings.aiTemperature      = parseFloat(aiTemperature);
    if (aiMaxTokens)        settings.aiMaxTokens        = parseInt(aiMaxTokens);
    if (summaryThreshold)   settings.summaryThreshold   = parseInt(summaryThreshold);
    if (contextWindowSize)  settings.contextWindowSize  = parseInt(contextWindowSize);

    // Audit entry
    settings.auditLog.push({
      changedBy: 'admin',
      field:     'bulk_update',
      newValue:  JSON.stringify(req.body).slice(0, 200),
    });
    // Keep last 100 audit entries
    if (settings.auditLog.length > 100) {
      settings.auditLog = settings.auditLog.slice(-100);
    }

    await settings.save();

    // Bust caches
    const { redisClient } = require('../config/redis');
    await Promise.all([
      redisClient.del('admin:settings'),
      redisClient.del('limits:config'),
    ]).catch(() => {});

    logger.info('Admin settings updated');
    return res.json({ status: 'ok', message: 'Settings saved' });
  } catch (err) {
    logger.error('Admin updateSettings error', { error: err.message });
    return res.status(400).json({ status: 'fail', message: err.message });
  }
}

// ---------------------------------------------------------------------------
// Broadcast message
// ---------------------------------------------------------------------------

async function broadcastMessage(req, res) {
  try {
    const { message, planFilter } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ status: 'fail', message: 'Message is required' });
    }

    const query = { isDeleted: false, isBanned: false };
    if (planFilter === 'premium') query.plan = 'premium';
    if (planFilter === 'free')    query.plan = 'free';

    const users = await User.find(query, { telegramId: 1 }).lean();
    const { sendMessage } = require('../services/bot/telegramService');

    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        await sendMessage(u.telegramId, message);
        sent++;
        // Small delay to respect Telegram rate limits (30 msg/s to different users)
        await new Promise(r => setTimeout(r, 35));
      } catch (_) {
        failed++;
      }
    }

    logger.info('Broadcast complete', { sent, failed, total: users.length });
    return res.json({ status: 'ok', sent, failed, total: users.length });
  } catch (err) {
    return res.status(500).json({ status: 'fail', message: err.message });
  }
}

module.exports = {
  getOverview,
  getUsers,
  banUser,
  unbanUser,
  getRevenue,
  getSettings,
  updateSettings,
  broadcastMessage,
};
