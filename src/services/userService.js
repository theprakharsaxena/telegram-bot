'use strict';

/**
 * UserService
 *
 * All business logic for user management lives here.
 * Handlers and commands never touch the User model directly —
 * they always go through this service.
 *
 * Responsibilities:
 *   - Get/update user profile
 *   - Update preferences
 *   - Switch personality
 *   - Ban / unban users
 *   - Soft delete (GDPR)
 *   - Aggregate stats for profile display
 */

const { User, Conversation, Message, Memory } = require('../models');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Get a user by Telegram ID. Throws 404 if not found.
 */
async function getUserByTelegramId(telegramId) {
  const user = await User.findByTelegramId(telegramId);
  if (!user) throw new AppError('User not found', 404);
  return user;
}

/**
 * Get full profile data for display — user doc + today's usage snapshot.
 */
async function getProfileData(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  await user.checkAndExpirePremium();
  return user;
}

// ---------------------------------------------------------------------------
// Update profile / preferences
// ---------------------------------------------------------------------------

/**
 * Update a user's preferences sub-document.
 * Only keys present in `updates` are changed — others are preserved.
 *
 * @param {number} telegramId
 * @param {object} updates — subset of preferences fields
 */
async function updatePreferences(telegramId, updates) {
  const allowed = [
    'language',
    'timezone',
    'notificationsEnabled',
    'typingSimulation',
    'memoryEnabled',
    'responseStyle',
    'directImageMode',
  ];

  const setFields = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      setFields[`preferences.${key}`] = updates[key];
    }
  }

  if (Object.keys(setFields).length === 0) {
    throw new AppError('No valid preference fields provided', 400);
  }

  const user = await User.findOneAndUpdate(
    { telegramId, isDeleted: false },
    { $set: setFields },
    { new: true, runValidators: true }
  );

  if (!user) throw new AppError('User not found', 404);
  logger.info('Preferences updated', { telegramId, fields: Object.keys(setFields) });
  return user;
}

/**
 * Switch the user's active personality.
 * Validates against available personalities in AdminSettings.
 *
 * @param {number} telegramId
 * @param {string} personalityKey — e.g. 'luna', 'aria', 'mia'
 */
async function switchPersonality(telegramId, personalityKey) {
  const { AdminSettings } = require('../models');
  const personality = await AdminSettings.getPersonality(personalityKey);

  if (!personality) {
    throw new AppError(`Personality "${personalityKey}" not found or inactive`, 404);
  }

  // Check premium-only personalities
  const user = await getUserByTelegramId(telegramId);
  if (personality.isPremiumOnly && !user.isPremium) {
    throw new AppError('This personality is available for premium members only', 403);
  }

  user.activePersonality = personalityKey;
  await user.save();

  logger.info('Personality switched', { telegramId, personalityKey });
  return { user, personality };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/**
 * Increment the user's lifetime stats counters.
 * Fire-and-forget — called after each message/image event.
 *
 * @param {number} telegramId
 * @param {object} increments — e.g. { totalMessages: 1 }
 */
async function incrementStats(telegramId, increments) {
  const inc = {};
  for (const [key, val] of Object.entries(increments)) {
    inc[`stats.${key}`] = val;
  }

  await User.findOneAndUpdate(
    { telegramId },
    {
      $inc: inc,
      $set: { 'stats.lastActiveAt': new Date() },
    }
  ).exec();
}

/**
 * Record first message timestamp if not already set.
 */
async function maybeSetFirstMessage(telegramId) {
  await User.findOneAndUpdate(
    { telegramId, 'stats.firstMessageAt': null },
    { $set: { 'stats.firstMessageAt': new Date() } }
  ).exec();
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/**
 * Ban a user. Stores reason and timestamp.
 */
async function banUser(telegramId, reason = 'Policy violation') {
  const user = await User.findOneAndUpdate(
    { telegramId },
    {
      $set: {
        isBanned: true,
        banReason: reason,
        bannedAt: new Date(),
      },
    },
    { new: true }
  );
  if (!user) throw new AppError('User not found', 404);
  logger.warn('User banned', { telegramId, reason });
  return user;
}

/**
 * Unban a user.
 */
async function unbanUser(telegramId) {
  const user = await User.findOneAndUpdate(
    { telegramId },
    {
      $set: { isBanned: false, banReason: null, bannedAt: null },
    },
    { new: true }
  );
  if (!user) throw new AppError('User not found', 404);
  logger.info('User unbanned', { telegramId });
  return user;
}

// ---------------------------------------------------------------------------
// Conversation reset
// ---------------------------------------------------------------------------

/**
 * Reset a user's active conversation for their current personality.
 * Closes the active conversation and clears messages.
 * Does NOT delete memories (memory is separate from chat history).
 *
 * @param {number} telegramId
 * @param {string} personality — defaults to user's active personality
 */
async function resetConversation(telegramId, personality = null) {
  const user = await getUserByTelegramId(telegramId);
  const targetPersonality = personality || user.activePersonality;

  // Find and close the active conversation
  const conversation = await Conversation.findOne({
    telegramId,
    personality: targetPersonality,
    isActive: true,
  });

  if (conversation) {
    // Permanently delete all messages in the conversation
    await Message.deleteMany({ conversationId: conversation._id });
    conversation.isActive = false;
    await conversation.save();
  }

  logger.info('Conversation reset', { telegramId, personality: targetPersonality });
  return { personality: targetPersonality, hadConversation: !!conversation };
}

/**
 * Clear all memories for a user.
 */
async function clearMemories(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  await Memory.updateMany(
    { userId: user._id },
    { $set: { isActive: false } }
  );
  logger.info('Memories cleared', { telegramId });
}

// ---------------------------------------------------------------------------
// Soft delete (GDPR)
// ---------------------------------------------------------------------------

/**
 * Soft-delete a user and anonymise their PII.
 * Conversation content is preserved for abuse audit purposes
 * but the user record is anonymised.
 */
async function deleteAccount(telegramId) {
  const user = await getUserByTelegramId(telegramId);
  await user.softDelete();
  // Clear memories too
  await Memory.updateMany({ userId: user._id }, { $set: { isActive: false } });
  logger.info('Account soft-deleted', { telegramId });
}

module.exports = {
  getUserByTelegramId,
  getProfileData,
  updatePreferences,
  switchPersonality,
  incrementStats,
  maybeSetFirstMessage,
  banUser,
  unbanUser,
  resetConversation,
  clearMemories,
  deleteAccount,
};
