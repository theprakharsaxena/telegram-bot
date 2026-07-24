'use strict';

/**
 * ImageService
 *
 * Wraps the Replicate API for SDXL image generation.
 *
 * Flow:
 *   1. Create a GeneratedImage record (status: pending)
 *   2. Submit prediction to Replicate
 *   3. Poll until succeeded / failed (max 120s)
 *   4. Update the GeneratedImage record
 *   5. Send the image to Telegram
 *   6. Save Telegram file_id for cheap re-sends
 *
 * Why polling instead of webhooks?
 *   Replicate webhooks require a public HTTPS URL at generation time.
 *   In development we use polling. In production both work — polling
 *   is simpler to deploy and reliable enough for image generation latency.
 */

const Replicate    = require('replicate');
const { GeneratedImage } = require('../../models');
const { buildImagePrompt } = require('./imagePromptBuilder');
const { sendPhoto, sendMessage } = require('../bot/telegramService');
const config       = require('../../config/env');
const logger       = require('../../utils/logger');

// Singleton Replicate client
const replicate = new Replicate({ auth: config.replicate.apiToken });

// Polling config
const POLL_INTERVAL_MS = 3000;  // check every 3 seconds
const POLL_TIMEOUT_MS  = 120000; // give up after 2 minutes

// ---------------------------------------------------------------------------
// Core generation function
// ---------------------------------------------------------------------------

/**
 * Generate an image and send it to the user.
 * Called by the BullMQ worker — runs in the background.
 *
 * @param {object} jobData
 * @param {string} jobData.generatedImageId  — GeneratedImage _id
 * @param {number} jobData.telegramId
 * @param {number} jobData.chatId
 * @param {string} jobData.userPrompt
 * @param {object} jobData.personality       — personality document snapshot
 */
async function processImageGeneration(jobData) {
  const { generatedImageId, telegramId, chatId, userPrompt, personality } = jobData;

  // Load the pending record
  const imageRecord = await GeneratedImage.findById(generatedImageId);
  if (!imageRecord) {
    logger.error('GeneratedImage record not found', { generatedImageId });
    return;
  }

  try {
    // ── 1. Build prompt ──────────────────────────────────────────────────
    const { enhancedPrompt, negativePrompt } = buildImagePrompt({
      userPrompt,
      personality,
      personalityName: personality?.name,
    });

    // Update record with prompt details
    imageRecord.enhancedPrompt   = enhancedPrompt;
    imageRecord.negativePrompt   = negativePrompt;
    imageRecord.status           = 'processing';
    imageRecord.generationStartedAt = new Date();
    await imageRecord.save();

    logger.info('Starting image generation', {
      telegramId,
      generatedImageId,
      scene: enhancedPrompt.slice(0, 80),
    });

    // ── 2. Submit to Replicate ───────────────────────────────────────────
    // Parse model string: "owner/model:version" or "owner/model"
    const modelStr = config.replicate.imageModel;
    const [modelPath, version] = modelStr.includes(':')
      ? [modelStr.split(':')[0], modelStr.split(':').slice(1).join(':')]
      : [modelStr, null];

    const input = {
      prompt:            enhancedPrompt,
      negative_prompt:   negativePrompt,
      width:             1024,
      height:            1024,
      num_inference_steps: 30,
      guidance_scale:    7.5,
      scheduler:         'K_EULER',
      num_outputs:       1,
    };

    let prediction;
    if (version) {
      prediction = await replicate.predictions.create({
        version,
        input,
      });
    } else {
      prediction = await replicate.run(modelPath, { input });
    }

    // If run() returned array directly (sync models), handle immediately
    if (Array.isArray(prediction)) {
      return await handleSuccessfulGeneration(
        imageRecord, prediction[0], chatId, personality
      );
    }

    // Save Replicate prediction ID for tracking
    imageRecord.replicatePredictionId = prediction.id;
    await imageRecord.save();

    // ── 3. Poll for completion ───────────────────────────────────────────
    const result = await pollPrediction(prediction.id);

    if (result.status === 'succeeded' && result.output?.length > 0) {
      await handleSuccessfulGeneration(
        imageRecord, result.output[0], chatId, personality
      );
    } else {
      await handleFailedGeneration(
        imageRecord,
        result.error || 'Generation failed',
        chatId
      );
    }

  } catch (err) {
    logger.error('Image generation error', {
      generatedImageId,
      telegramId,
      error: err.message,
    });
    await handleFailedGeneration(imageRecord, err.message, chatId);
  }
}

// ---------------------------------------------------------------------------
// Poll Replicate prediction until done
// ---------------------------------------------------------------------------

async function pollPrediction(predictionId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const prediction = await replicate.predictions.get(predictionId);

    if (prediction.status === 'succeeded' || prediction.status === 'failed' ||
        prediction.status === 'canceled') {
      return prediction;
    }

    logger.info('Polling prediction', { predictionId, status: prediction.status });
  }

  // Timeout — treat as failed
  return { status: 'failed', error: 'Generation timed out after 2 minutes' };
}

// ---------------------------------------------------------------------------
// Success / failure handlers
// ---------------------------------------------------------------------------

async function handleSuccessfulGeneration(imageRecord, imageUrl, chatId, personality) {
  const durationMs = imageRecord.generationStartedAt
    ? Date.now() - new Date(imageRecord.generationStartedAt).getTime()
    : null;

  // Update record
  imageRecord.status                = 'succeeded';
  imageRecord.imageUrl              = imageUrl;
  imageRecord.generationCompletedAt = new Date();
  imageRecord.generationDurationMs  = durationMs;
  await imageRecord.save();

  // Send to Telegram
  try {
    const caption = personality?.name
      ? `📸 <i>Here you go! — ${personality.name}</i>`
      : `📸 <i>Here's your image!</i>`;

    const sent = await sendPhoto(chatId, imageUrl, { caption });

    // Save Telegram file_id for cheap re-sends
    const fileId = sent?.photo?.[sent.photo.length - 1]?.file_id;
    if (fileId) {
      imageRecord.telegramFileId = fileId;
      await imageRecord.save();
    }

    logger.info('Image sent to user', {
      telegramId: imageRecord.telegramId,
      durationMs,
      imageUrl: imageUrl.slice(0, 60),
    });
  } catch (sendErr) {
    logger.error('Failed to send image to Telegram', { error: sendErr.message });
    // Image was generated — don't mark as failed, just log
  }
}

async function handleFailedGeneration(imageRecord, errorMessage, chatId) {
  imageRecord.status            = 'failed';
  imageRecord.errorMessage      = errorMessage?.slice(0, 500);
  imageRecord.generationCompletedAt = new Date();
  await imageRecord.save();

  logger.error('Image generation failed', {
    generatedImageId: imageRecord._id,
    error:            errorMessage,
  });

  // Notify user
  try {
    await sendMessage(
      chatId,
      `😔 I couldn't generate that image right now. Please try again in a moment!\n` +
      `<i>Use /images to see your previous images.</i>`
    );
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Create pending record (called before queuing the job)
// ---------------------------------------------------------------------------

/**
 * Create a GeneratedImage document in 'pending' state.
 * Returns the record — its _id is passed to the BullMQ job.
 */
async function createPendingImageRecord({
  userId,
  telegramId,
  conversationId,
  triggerMessageId,
  userPrompt,
  personality,
  userPlan,
}) {
  const { enhancedPrompt, negativePrompt } = buildImagePrompt({
    userPrompt,
    personality,
    personalityName: personality?.name,
  });

  return GeneratedImage.create({
    userId,
    telegramId,
    conversationId,
    triggerMessageId,
    userPrompt,
    enhancedPrompt,
    negativePrompt,
    model:    config.replicate.imageModel,
    width:    1024,
    height:   1024,
    steps:    30,
    status:   'pending',
    userPlan,
  });
}

// ---------------------------------------------------------------------------
// Image history
// ---------------------------------------------------------------------------

/**
 * Get recent generated images for a user.
 */
async function getImageHistory(userId, limit = 10, page = 1) {
  const skip = (page - 1) * limit;
  return GeneratedImage.find(
    { userId, status: 'succeeded' },
    { userPrompt: 1, imageUrl: 1, telegramFileId: 1, createdAt: 1, userPlan: 1 }
  )
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  processImageGeneration,
  createPendingImageRecord,
  getImageHistory,
};
