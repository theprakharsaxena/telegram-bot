'use strict';

/**
 * ImageService
 *
 * Handles image generation routing between Fal AI and Runware AI.
 * Uses Fal AI (Sana model) by default, and Runware AI if the prompt contains explicit words.
 *
 * Flow:
 *   1. Create a GeneratedImage record (status: pending)
 *   2. Detect if prompt contains explicit keywords
 *   3. Generate image using the selected API
 *   4. Update the GeneratedImage record
 *   5. Send the image to Telegram
 *   6. Save Telegram file_id for cheap re-sends
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { GeneratedImage } = require('../../models');
const { buildImagePrompt } = require('./imagePromptBuilder');
const { sendPhoto, sendMessage, deleteMessage } = require('../bot/telegramService');
const config       = require('../../config/env');
const logger       = require('../../utils/logger');

// Axios instances for Fal AI and Runware AI
const falAxiosInstance = axios.create({
  timeout: 30000,
  headers: {
    Authorization: `Key ${process.env.FAL_KEY}`,
    "Content-Type": "application/json",
  },
});

const runwareAxiosInstance = axios.create({
  baseURL: "https://api.runware.ai/v1",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Regex to detect explicit/suggestive words for routing to Runware AI
const EXPLICIT_WORDS = /\b(nudes?|naked(ness|ly)?|underwear|bikinis?|lingerie|panties|bras?|asses?|boobs?|boobies?|breasts?|tits?|puss(y|ies)|vaginas?|cunts?|nipples?|clits?|clitoris|bottomless|sex|sexy|sensual|explicit|nsfw|seductive|revealing|boudoir|cleavage|hot|erotic|porn|xxx|butts?|thongs?|stockings?|g-strings?|tanga|bralettes?|babydoll|negligee|topless|nacked|undressed|strips?|stripping|naughty|humps?|fucks?|fucking|masturbat(e|ing|ion)|orgasms?|erogenous|fetishes?|kinky|bdsm|bondage|erotica|seduces?|seduction|sensually|erotical|voluptuous|peekaboo)\b/i;

// Helper function for Fal AI image generation (Sana model)
async function generateImageWithFal(prompt, width = 1024, height = 1024) {
  try {
    if (!prompt?.trim()) {
      throw new Error("Prompt is required and cannot be empty");
    }

    const imagePromptData = {
      prompt: prompt.trim(),
      image_size: {
        width: width,
        height: height
      },
      enable_safety_checker: false,
    };

    const queueResponse = await falAxiosInstance.post(
      "https://queue.fal.run/fal-ai/sana",
      imagePromptData
    );

    const requestId = queueResponse.data.request_id;
    let attempts = 0;
    const maxAttempts = 30;
    let imageUrl = null;

    while (attempts < maxAttempts) {
      const statusResponse = await falAxiosInstance.get(
        `https://queue.fal.run/fal-ai/sana/requests/${requestId}/status`
      );

      if (statusResponse.data.status === "COMPLETED") {
        const resultResponse = await falAxiosInstance.get(
          `https://queue.fal.run/fal-ai/sana/requests/${requestId}`
        );

        const resultData = resultResponse.data;
        const hasNSFW = resultData?.has_nsfw_concepts && resultData.has_nsfw_concepts.includes(true);

        if (hasNSFW) {
          logger.warn("Fal AI generated image has NSFW concepts, throwing fallback indicator");
          throw new Error("NSFW_DETECTED_BY_FAL");
        }

        if (resultData.images?.[0]?.url) {
          imageUrl = resultData.images[0].url;
          logger.info("Image generated successfully with fal.ai");
          break;
        }
      } else if (statusResponse.data.status === "FAILED") {
        throw new Error("Fal.ai image generation failed");
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!imageUrl && attempts >= maxAttempts) {
      throw new Error("Fal.ai image generation timed out");
    }

    return imageUrl;
  } catch (falError) {
    logger.error("Fal.ai error", { error: falError.message });
    throw new Error("Fal AI image generation failed: " + falError.message);
  }
}

// Helper function for Runware AI image generation
async function generateImageWithRunware(prompt) {
  try {
    const taskUUID = uuidv4();
    const apiKey = process.env.RUNWARE_API_KEY;

    if (!apiKey) {
      throw new Error("RUNWARE_API_KEY is not set in environment variables");
    }

    const requestPayload = [
      {
        taskType: "authentication",
        apiKey: apiKey,
      },
      {
        taskType: "imageInference",
        model: "civitai:573152@638929",
        positivePrompt: prompt,
        height: 1024,
        width: 1024,
        numberResults: 1,
        outputType: [ "URL"],
        outputFormat: "JPEG",
        taskUUID: taskUUID,
      },
    ];

    const response = await runwareAxiosInstance.post("", requestPayload);

    if (response.data?.data && Array.isArray(response.data.data)) {
      const imageTask = response.data.data.find(
        (item) =>
          item.taskType === "imageInference" && item.taskUUID === taskUUID
      );

      if (imageTask?.imageURL) {
        logger.info("Image generated successfully with Runware AI");
        return imageTask.imageURL;
      } else {
        throw new Error("No image URL in Runware AI response");
      }
    } else {
      throw new Error("Invalid response format from Runware AI");
    }
  } catch (error) {
    logger.error("Runware AI Error", { error: error.message });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Core generation function
// ---------------------------------------------------------------------------

/**
 * Generate an image and send it to the user.
 * Called by the BullMQ worker — runs in the background.
 */
async function processImageGeneration(jobData) {
  const { generatedImageId, telegramId, chatId, userPrompt, personality, loadingMessageId } = jobData;

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

    // Check for explicit words to determine routing
    const isExplicit = EXPLICIT_WORDS.test(userPrompt) || EXPLICIT_WORDS.test(enhancedPrompt);
    let imageUrl = null;

    if (isExplicit) {
      logger.info('Explicit prompt detected, routing to Runware AI', { telegramId, userPrompt });
      imageRecord.model = 'runware-civitai:573152@638929';
      await imageRecord.save();
      imageUrl = await generateImageWithRunware(enhancedPrompt);
    } else {
      logger.info('Default prompt, routing to Fal AI (Sana)', { telegramId, userPrompt });
      imageRecord.model = 'fal-ai/sana';
      await imageRecord.save();
      try {
        imageUrl = await generateImageWithFal(enhancedPrompt);
      } catch (falErr) {
        if (falErr.message.includes("NSFW_DETECTED_BY_FAL")) {
          logger.warn("Fal AI generated image has NSFW content. Automatically falling back to Runware AI.", { telegramId, userPrompt });
          imageRecord.model = 'runware-civitai:573152@638929';
          await imageRecord.save();
          imageUrl = await generateImageWithRunware(enhancedPrompt);
        } else {
          throw falErr;
        }
      }
    }

    if (loadingMessageId) {
      await deleteMessage(chatId, loadingMessageId).catch(() => {});
    }

    if (imageUrl) {
      await handleSuccessfulGeneration(imageRecord, imageUrl, chatId, personality);
    } else {
      await handleFailedGeneration(imageRecord, 'Image generation returned empty URL', chatId);
    }

  } catch (err) {
    if (loadingMessageId) {
      await deleteMessage(chatId, loadingMessageId).catch(() => {});
    }
    logger.error('Image generation error', {
      generatedImageId,
      telegramId,
      error: err.message,
    });
    await handleFailedGeneration(imageRecord, err.message, chatId);
  }
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
    model:    'fal-ai/sana', // Default model reference
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

module.exports = {
  processImageGeneration,
  createPendingImageRecord,
  getImageHistory,
};
