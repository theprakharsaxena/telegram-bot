'use strict';

/**
 * ConversationService
 *
 * Manages the full lifecycle of a conversation:
 *   - Get or create the active session
 *   - Save messages (user + assistant)
 *   - Fetch the context window for OpenAI
 *   - Trigger summarisation when the window grows too large
 *   - Trigger memory extraction at configurable intervals
 *
 * This service is the bridge between the raw Telegram messages
 * and the AI prompt assembly layer.
 */

const { Conversation, Message, AdminSettings } = require('../../models');
const { redisClient } = require('../../config/redis');
const logger = require('../../utils/logger');

// Redis key prefix for conversation context cache
const CTX_CACHE_PREFIX = 'conv:ctx:';
const CTX_CACHE_TTL    = 300; // 5 minutes

// ---------------------------------------------------------------------------
// Get or create conversation
// ---------------------------------------------------------------------------

/**
 * Get the active conversation for a user+personality, creating it if needed.
 * Updates conversation metadata (lastMessageAt, preview).
 */
async function getOrCreateConversation(userId, telegramId, personality) {
  return Conversation.getOrCreate(userId, telegramId, personality);
}

// ---------------------------------------------------------------------------
// Save messages
// ---------------------------------------------------------------------------

/**
 * Save a user message to the database.
 * Returns the saved Message document.
 */
async function saveUserMessage(conversationId, userId, telegramId, {
  content,
  personality,
  telegramMessageId = null,
  hasImage = false,
  imageFileId = null,
}) {
  const sequenceIndex = await Message.nextSequenceIndex(conversationId);

  const message = await Message.create({
    conversationId,
    userId,
    telegramId,
    role: 'user',
    content,
    personality,
    telegramMessageId,
    hasImage,
    imageFileId,
    sequenceIndex,
  });

  // Update conversation counters + preview
  await Conversation.findByIdAndUpdate(conversationId, {
    $inc: { messageCount: 1, userMessageCount: 1 },
    $set: {
      lastMessageAt: new Date(),
      lastMessagePreview: content.slice(0, 200),
    },
  });

  // Invalidate context cache
  await invalidateContextCache(conversationId);

  return message;
}

/**
 * Save an assistant (AI) message to the database.
 * Returns the saved Message document.
 */
async function saveAssistantMessage(conversationId, userId, telegramId, {
  content,
  personality,
  model,
  tokenUsage = null,
  botMessageId = null,
}) {
  const sequenceIndex = await Message.nextSequenceIndex(conversationId);

  const message = await Message.create({
    conversationId,
    userId,
    telegramId,
    role: 'assistant',
    content,
    personality,
    model,
    tokenUsage,
    botMessageId,
    sequenceIndex,
  });

  await Conversation.findByIdAndUpdate(conversationId, {
    $inc: { messageCount: 1 },
    $set: { lastMessageAt: new Date() },
  });

  await invalidateContextCache(conversationId);
  return message;
}

// ---------------------------------------------------------------------------
// Context window
// ---------------------------------------------------------------------------

/**
 * Build the OpenAI messages array from conversation history.
 * Uses Redis cache to avoid DB reads on every single message.
 *
 * Returns: Array<{ role: string, content: string }>
 */
async function getContextWindow(conversation, settings) {
  const cacheKey = CTX_CACHE_PREFIX + conversation._id.toString();

  // Try cache first
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    logger.warn('Context cache read failed', { error: err.message });
  }

  const windowSize      = settings?.contextWindowSize || 20;
  const afterIndex      = conversation.summarisedUpToMessageIndex || 0;

  const messages = await Message.getContextWindow(
    conversation._id,
    windowSize,
    afterIndex
  );

  // Cache the result
  try {
    await redisClient.setex(cacheKey, CTX_CACHE_TTL, JSON.stringify(messages));
  } catch (err) {
    logger.warn('Context cache write failed', { error: err.message });
  }

  return messages;
}

/**
 * Invalidate the context cache for a conversation.
 * Called after any message is saved.
 */
async function invalidateContextCache(conversationId) {
  try {
    await redisClient.del(CTX_CACHE_PREFIX + conversationId.toString());
  } catch (err) {
    // Non-fatal — cache will expire naturally
    logger.warn('Context cache invalidation failed', { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Summarisation
// ---------------------------------------------------------------------------

/**
 * Check if the conversation needs summarisation and trigger it if so.
 * Called after each assistant message is saved.
 *
 * Summarisation kicks in when:
 *   messageCount > summaryThreshold (configurable in AdminSettings)
 *   AND messageCount - summarisedUpToMessageIndex > summaryThreshold
 *
 * @param {object} conversation  — Conversation document
 * @param {object} settings      — AdminSettings document
 * @param {Function} summarise   — async fn(messages) → string
 */
async function maybeSummarise(conversation, settings, summariseFn) {
  const threshold = settings?.summaryThreshold || 40;
  const unsummarisedCount =
    conversation.messageCount - (conversation.summarisedUpToMessageIndex || 0);

  if (unsummarisedCount < threshold) return false;

  logger.info('Triggering conversation summarisation', {
    conversationId: conversation._id,
    messageCount: conversation.messageCount,
    unsummarisedCount,
  });

  try {
    // Fetch the messages that need summarising
    const messagesToSummarise = await Message.find(
      {
        conversationId: conversation._id,
        isHidden: false,
        sequenceIndex: {
          $gt: conversation.summarisedUpToMessageIndex || 0,
          $lte: conversation.messageCount - 10, // keep last 10 out of summary
        },
      },
      { role: 1, content: 1, sequenceIndex: 1 }
    )
      .sort({ sequenceIndex: 1 })
      .lean();

    if (messagesToSummarise.length < 10) return false;

    // Call the summarisation function (provided by AIService to avoid circular dep)
    const newSummary = await summariseFn(
      messagesToSummarise,
      conversation.summary
    );

    const lastSummarisedIndex =
      messagesToSummarise[messagesToSummarise.length - 1].sequenceIndex;

    await Conversation.findByIdAndUpdate(conversation._id, {
      $set: {
        summary: newSummary,
        lastSummarisedAt: new Date(),
        summarisedUpToMessageIndex: lastSummarisedIndex,
      },
    });

    await invalidateContextCache(conversation._id);
    logger.info('Conversation summarised', {
      conversationId: conversation._id,
      summaryLength: newSummary.length,
    });

    return true;
  } catch (err) {
    logger.error('Summarisation failed', {
      conversationId: conversation._id,
      error: err.message,
    });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Memory extraction trigger
// ---------------------------------------------------------------------------

/**
 * Check if it's time to extract memories from recent messages.
 * Returns the messages to extract from, or null if not time yet.
 *
 * @param {object} conversation
 * @param {object} settings
 */
async function getMessagesForMemoryExtraction(conversation, settings) {
  const interval = settings?.memoryExtractionInterval || 10;

  // Extract every `interval` user messages
  if (conversation.userMessageCount % interval !== 0) return null;
  if (conversation.userMessageCount === 0) return null;

  // Get the last `interval * 2` messages for context
  const messages = await Message.find(
    {
      conversationId: conversation._id,
      isHidden: false,
    },
    { role: 1, content: 1 }
  )
    .sort({ sequenceIndex: -1 })
    .limit(interval * 2)
    .lean();

  return messages.reverse();
}

module.exports = {
  getOrCreateConversation,
  saveUserMessage,
  saveAssistantMessage,
  getContextWindow,
  invalidateContextCache,
  maybeSummarise,
  getMessagesForMemoryExtraction,
};
