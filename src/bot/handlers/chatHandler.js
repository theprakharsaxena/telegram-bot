'use strict';

/**
 * ChatHandler
 *
 * The main message handler — orchestrates the full AI response pipeline:
 *
 *   1.  Spam guard (length cap + repeat detection)
 *   2.  Check maintenance mode / ban (done by botAuth)
 *   3.  Detect if the message is an image request
 *   4.  Load AdminSettings (cached)
 *   5.  CHECK MESSAGE LIMIT — block if exceeded
 *   6.  Load/create the active conversation
 *   7.  Send typing indicator (non-blocking)
 *   8.  Save the user message to DB
 *   9.  Fetch conversation context window
 *   10. Load personality
 *   11. Generate AI response via OpenAI
 *   12. Send the response to Telegram
 *   13. Save the assistant message to DB
 *   14. INCREMENT message counter (after successful response)
 *   15. Update user stats (fire-and-forget)
 *   16. Trigger summarisation check (async, non-blocking)
 *   17. Trigger memory extraction check (async, non-blocking)
 *   18. Trigger image generation if image was requested (async)
 */

const { sendMessage, sendTyping }     = require('../../services/bot/telegramService');
const { AdminSettings }               = require('../../models');
const { detectImageRequest }          = require('../../services/ai/imageDetectionService');
const conversationService             = require('../../services/ai/conversationService');
const aiService                       = require('../../services/ai/aiService');
const userService                     = require('../../services/userService');
const usageService                    = require('../../services/usage/usageService');
const { createPendingImageRecord }    = require('../../services/image/imageService');
const { queueImageGeneration }        = require('../../jobs/imageQueue');
const { sanitiseUserMessage,
        sanitiseAiResponse }          = require('../../utils/sanitizer');
const { redisClient }                 = require('../../config/redis');
const logger                          = require('../../utils/logger');
const config                          = require('../../config/env');

// Redis key for AdminSettings cache
const SETTINGS_CACHE_KEY = 'admin:settings';
const SETTINGS_CACHE_TTL = 120; // 2 minutes

// Per-user processing lock
const PROCESSING_LOCK_PREFIX = 'lock:chat:';
const PROCESSING_LOCK_TTL    = 30; // seconds

// Spam guard constants
const MAX_MESSAGE_LENGTH   = 2000; // characters
const REPEAT_WINDOW_KEY    = 'spam:repeat:';
const REPEAT_WINDOW_TTL    = 60;   // seconds
const REPEAT_MAX_IDENTICAL = 3;    // block after 3 identical messages in 60s

// ---------------------------------------------------------------------------
// Settings cache helper
// ---------------------------------------------------------------------------
async function getCachedSettings() {
  try {
    const cached = await redisClient.get(SETTINGS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  const settings = await AdminSettings.getSettings();

  try {
    await redisClient.setex(SETTINGS_CACHE_KEY, SETTINGS_CACHE_TTL, JSON.stringify(settings));
  } catch (_) {}

  return settings;
}

// ---------------------------------------------------------------------------
// Typing simulation
// ---------------------------------------------------------------------------
function simulateTyping(chatId, durationMs = 3000) {
  const interval   = 4500;
  const iterations = Math.ceil(durationMs / interval);
  let count = 0;

  const tick = () => {
    if (count >= iterations) return;
    sendTyping(chatId);
    count++;
    setTimeout(tick, interval);
  };

  tick();
}

// ---------------------------------------------------------------------------
// Spam guard
// ---------------------------------------------------------------------------

/**
 * Check if the message violates spam rules.
 * Returns { blocked: true, reason } or { blocked: false }.
 */
async function checkSpam(telegramId, text) {
  // 1. Length cap
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      blocked: true,
      reason:  `✋ Message too long! Please keep it under ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }

  // 2. Repeated identical message detection
  try {
    const hash    = Buffer.from(text.toLowerCase().trim()).toString('base64').slice(0, 32);
    const key     = REPEAT_WINDOW_KEY + telegramId + ':' + hash;
    const count   = await redisClient.incr(key);

    // Set TTL only on first occurrence
    if (count === 1) {
      await redisClient.expire(key, REPEAT_WINDOW_TTL);
    }

    if (count > REPEAT_MAX_IDENTICAL) {
      return {
        blocked: true,
        reason:  `🔁 You've sent that message several times. Mix it up — I'm here to chat! 😊`,
      };
    }
  } catch (_) {
    // Redis unavailable — don't block, just log
    logger.warn('Spam repeat check skipped — Redis unavailable');
  }

  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Process a text message from a user.
 */
async function handleChatMessage(msg) {
  const { user, chatId } = msg._ctx;
  const text = msg.text?.trim();

  if (!text) return;

  // ── Spam guard ───────────────────────────────────────────────────────────
  const spamCheck = await checkSpam(user.telegramId, text);
  if (spamCheck.blocked) {
    await sendMessage(chatId, spamCheck.reason);
    return;
  }

  // ── Prompt injection sanitisation ────────────────────────────────────────
  const { sanitised, wasModified, flags } = sanitiseUserMessage(text);
  if (flags.includes('injection_detected')) {
    logger.warn('Prompt injection attempt detected', {
      telegramId: user.telegramId,
      flags,
      original: text.slice(0, 100),
    });
  }
  // Use sanitised text for AI — original text for display/storage
  const aiText = sanitised || text;

  // ── Per-user processing lock ─────────────────────────────────────────────
  const lockKey      = PROCESSING_LOCK_PREFIX + user.telegramId;
  const lockAcquired = await redisClient.set(lockKey, '1', 'EX', PROCESSING_LOCK_TTL, 'NX');

  if (!lockAcquired) {
    await sendMessage(chatId, '⏳ Still thinking about your last message — give me a moment!');
    return;
  }

  try {
    // ── 1. Load settings ────────────────────────────────────────────────
    const settings    = await getCachedSettings();
    const isPremium   = user.isPremium;
    const plan        = isPremium ? 'premium' : 'free';
    const memoryLimit = isPremium
      ? settings.premiumLimits?.memoryLimit ?? config.limits.premium.memoryLimit
      : settings.freeLimits?.memoryLimit    ?? config.limits.free.memoryLimit;

    // ── 2. Check message limit BEFORE doing any AI work ─────────────────
    const limitCheck = await usageService.checkMessageLimit(
      user._id,
      user.telegramId,
      plan
    );

    if (!limitCheck.allowed) {
      await sendMessage(
        chatId,
        usageService.buildLimitExceededMessage(
          'message',
          limitCheck.used,
          limitCheck.limit,
          limitCheck.resetAt,
          isPremium
        )
      );
      return;
    }

    // ── 3. Detect image request ─────────────────────────────────────────
    const { isImageRequest } = detectImageRequest(text);

    // ── 4. Get active personality ───────────────────────────────────────
    const personalityKey = user.activePersonality || 'sarah-23';
    const personality    = settings.personalities?.find(
      (p) => p.key === personalityKey && p.isActive
    );

    if (!personality) {
      await sendMessage(chatId, '😔 Could not load personality. Try /personality to reset!');
      return;
    }

    // ── 5. Get or create conversation ──────────────────────────────────
    const conversation = await conversationService.getOrCreateConversation(
      user._id,
      user.telegramId,
      personalityKey
    );

    // ── 6. Start typing simulation (non-blocking) ──────────────────────
    if (user.preferences?.typingSimulation !== false) {
      simulateTyping(chatId, 4000);
    }

    // ── 7. Save user message ──────────────────────────────────────────
    await conversationService.saveUserMessage(
      conversation._id,
      user._id,
      user.telegramId,
      {
        content:           text,        // store original text
        personality:       personalityKey,
        telegramMessageId: msg.message_id,
      }
    );

    // ── 8. Get context window ─────────────────────────────────────────
    const contextMessages = await conversationService.getContextWindow(
      conversation,
      settings
    );

    // ── 9. Generate AI response ───────────────────────────────────────
    const { content: rawAiResponse, tokenUsage, model } = await aiService.generateChatResponse({
      personality,
      user,
      contextMessages,
      userMessage:  aiText,             // send sanitised text to OpenAI
      summary:      conversation.summary,
      settings,
      memoryLimit,
    });

    // Sanitise AI response before sending to Telegram
    const aiResponse = sanitiseAiResponse(rawAiResponse);

    // ── 10. Send response to Telegram ─────────────────────────────────
    const sentMessage = await sendMessage(chatId, aiResponse);

    // ── 11. Save assistant message ────────────────────────────────────
    await conversationService.saveAssistantMessage(
      conversation._id,
      user._id,
      user.telegramId,
      {
        content:     aiResponse,
        personality: personalityKey,
        model,
        tokenUsage,
        botMessageId: sentMessage?.message_id || null,
      }
    );

    // ── 12. Increment usage counter (AFTER successful response) ─────────
    // Only count once AI has successfully responded — don't penalise errors
    const usageResult = await usageService.incrementMessages(user.telegramId);

    // Nudge user when they hit exactly their limit
    if (usageResult.isAtLimit && !isPremium) {
      setImmediate(async () => {
        await sendMessage(
          chatId,
          `⚠️ That was your last free message for today!\n\n` +
          `Your limit resets at midnight UTC. ` +
          `Upgrade to Premium with /premium for ${config.limits.premium.dailyMessages} messages/day! ⭐`
        ).catch(() => {});
      });
    }

    // ── 13. Update user stats (fire-and-forget) ───────────────────────
    userService.incrementStats(user.telegramId, { totalMessages: 2 }).catch(() => {});
    userService.maybeSetFirstMessage(user.telegramId).catch(() => {});

    // ── 14. Post-response async tasks ─────────────────────────────────
    setImmediate(() => {
      const { Conversation } = require('../../models');
      Conversation.findById(conversation._id).then(async (freshConv) => {
        if (!freshConv) return;

        await conversationService.maybeSummarise(
          freshConv,
          settings,
          (msgs, existing) =>
            aiService.summariseConversation(msgs, existing, user.displayName)
        );

        const memoryMessages = await conversationService.getMessagesForMemoryExtraction(
          freshConv,
          settings
        );
        if (memoryMessages) {
          await extractAndSaveMemories(memoryMessages, user, conversation._id);
        }
      }).catch((err) => {
        logger.error('Post-response async tasks failed', { error: err.message });
      });
    });

    // ── 15. Trigger image generation if requested ─────────────────────
    if (isImageRequest) {
      // Check image limit before queuing
      const imgLimitCheck = await usageService.checkImageLimit(
        user._id,
        user.telegramId,
        plan
      );

      if (!imgLimitCheck.allowed) {
        setImmediate(async () => {
          await sendMessage(
            chatId,
            usageService.buildLimitExceededMessage(
              'image',
              imgLimitCheck.used,
              imgLimitCheck.limit,
              imgLimitCheck.resetAt,
              isPremium
            )
          ).catch(() => {});
        });
      } else {
        setImmediate(async () => {
          try {
            // Create DB record
            const imageRecord = await createPendingImageRecord({
              userId:           user._id,
              telegramId:       user.telegramId,
              conversationId:   conversation._id,
              userPrompt:       text,
              personality,
              userPlan:         plan,
            });

            // Queue the generation job
            await queueImageGeneration(
              {
                generatedImageId: imageRecord._id.toString(),
                telegramId:       user.telegramId,
                chatId,
                userPrompt:       text,
                personality:      {
                  key:              personality.key,
                  name:             personality.name,
                  imageStylePrompt: personality.imageStylePrompt,
                },
                isPremium,
              },
              isPremium
            );

            // Increment image usage counter immediately on queue
            await usageService.incrementImages(user.telegramId);

            // Update user lifetime image stat
            userService.incrementStats(user.telegramId, { totalImages: 1 }).catch(() => {});

            logger.info('Image generation queued', {
              telegramId:       user.telegramId,
              generatedImageId: imageRecord._id,
            });
          } catch (err) {
            logger.error('Image queue error', { error: err.message });
            await sendMessage(
              chatId,
              '😔 Could not queue image generation. Please try again!'
            ).catch(() => {});
          }
        });
      }
    }

  } catch (err) {
    logger.error('chatHandler error', {
      telegramId: user.telegramId,
      error:      err.message,
      stack:      err.stack,
    });

    const userMessage = err.isOperational
      ? err.message
      : "I'm having a little moment — please try again! 😅";

    await sendMessage(chatId, userMessage).catch(() => {});

  } finally {
    await redisClient.del(lockKey).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Memory extraction helper
// ---------------------------------------------------------------------------
async function extractAndSaveMemories(messages, user, conversationId) {
  try {
    const { Memory } = require('../../models');
    const crypto     = require('crypto');

    const extracted = await aiService.extractMemories(messages, user.displayName);
    if (!extracted.length) return;

    for (const mem of extracted) {
      if (!mem.content || mem.confidence < 0.6) continue;

      const contentHash = crypto
        .createHash('sha256')
        .update(mem.content.toLowerCase().trim())
        .digest('hex')
        .slice(0, 32);

      await Memory.upsertMemory({
        userId:               user._id,
        telegramId:           user.telegramId,
        sourceConversationId: conversationId,
        content:              mem.content,
        category:             mem.category  || 'other',
        importance:           mem.importance || 0.5,
        confidence:           mem.confidence || 0.8,
        contentHash,
      });
    }

    logger.info('Memories extracted and saved', {
      telegramId: user.telegramId,
      count:      extracted.length,
    });
  } catch (err) {
    logger.error('Memory save failed', { error: err.message });
  }
}

module.exports = { handleChatMessage };
