'use strict';

/**
 * Image Generation Queue
 *
 * BullMQ queue + worker for async image generation.
 *
 * Why a queue instead of setImmediate()?
 *   - Image generation takes 20-60 seconds. If the server restarts mid-job,
 *     a setImmediate job is lost. BullMQ persists jobs in Redis so they
 *     survive restarts and are retried automatically.
 *   - Priority support: premium users get their images first.
 *   - Concurrency control: we process max 2 images at once to stay within
 *     Replicate's rate limits and keep server memory predictable.
 *   - Built-in retry with backoff: if Replicate returns a 5xx, the job
 *     retries up to 3 times with exponential delay.
 *
 * Queue name: 'image-generation'
 * Job name:   'generate'
 *
 * Job data shape:
 *   {
 *     generatedImageId: string,  — GeneratedImage._id
 *     telegramId:       number,
 *     chatId:           number,
 *     userPrompt:       string,
 *     personality:      object,  — personality document snapshot
 *     isPremium:        boolean,
 *   }
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const { bullRedis }                  = require('../config/redis');
const { processImageGeneration }     = require('../services/image/imageService');
const logger                         = require('../utils/logger');

const QUEUE_NAME   = 'image-generation';
const CONCURRENCY  = 2; // max simultaneous Replicate API calls

// ---------------------------------------------------------------------------
// Queue instance (used by producers to add jobs)
// ---------------------------------------------------------------------------
const imageQueue = new Queue(QUEUE_NAME, {
  connection: bullRedis,
  defaultJobOptions: {
    attempts:     3,
    backoff: {
      type:  'exponential',
      delay: 5000, // 5s → 10s → 20s
    },
    removeOnComplete: { count: 100 }, // keep last 100 completed jobs for audit
    removeOnFail:     { count: 200 }, // keep last 200 failed jobs for debugging
  },
});

// ---------------------------------------------------------------------------
// Worker instance (processes jobs)
// ---------------------------------------------------------------------------
let workerInstance = null;

/**
 * Start the image generation worker.
 * Called once during server startup (after DB + Redis are connected).
 */
function startImageWorker() {
  if (workerInstance) return workerInstance;

  workerInstance = new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info('Image job started', {
        jobId:           job.id,
        telegramId:      job.data.telegramId,
        generatedImageId: job.data.generatedImageId,
        attempt:         job.attemptsMade + 1,
      });

      await processImageGeneration(job.data);
    },
    {
      connection:  bullRedis,
      concurrency: CONCURRENCY,
      // Stall detection: if a worker crashes mid-job, BullMQ will
      // re-queue it after this timeout (ms)
      stalledInterval: 30000,
      maxStalledCount:  1,
    }
  );

  // ── Worker event handlers ────────────────────────────────────────────────
  workerInstance.on('completed', (job) => {
    logger.info('Image job completed', {
      jobId:      job.id,
      telegramId: job.data.telegramId,
    });
  });

  workerInstance.on('failed', (job, err) => {
    logger.error('Image job failed', {
      jobId:      job?.id,
      telegramId: job?.data?.telegramId,
      attempt:    job?.attemptsMade,
      error:      err.message,
    });
  });

  workerInstance.on('error', (err) => {
    logger.error('Image worker error', { error: err.message });
  });

  workerInstance.on('stalled', (jobId) => {
    logger.warn('Image job stalled', { jobId });
  });

  logger.info(`Image generation worker started (concurrency: ${CONCURRENCY})`);
  return workerInstance;
}

// ---------------------------------------------------------------------------
// Job producer helper
// ---------------------------------------------------------------------------

/**
 * Add an image generation job to the queue.
 *
 * @param {object} data          — job data (see shape above)
 * @param {boolean} isPremium    — premium users get higher priority
 * @returns {Promise<Job>}
 */
async function queueImageGeneration(data, isPremium = false) {
  const priority = isPremium ? 1 : 10; // lower number = higher priority

  const job = await imageQueue.add('generate', data, {
    priority,
    jobId: `img-${data.generatedImageId}`, // idempotent — prevents duplicate jobs
  });

  logger.info('Image job queued', {
    jobId:           job.id,
    telegramId:      data.telegramId,
    generatedImageId: data.generatedImageId,
    priority,
  });

  return job;
}

// ---------------------------------------------------------------------------
// Queue stats helper (used by admin dashboard)
// ---------------------------------------------------------------------------
async function getQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    imageQueue.getWaitingCount(),
    imageQueue.getActiveCount(),
    imageQueue.getCompletedCount(),
    imageQueue.getFailedCount(),
  ]);
  return { waiting, active, completed, failed };
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function closeImageQueue() {
  try {
    if (workerInstance) {
      await workerInstance.close();
      logger.info('Image worker closed gracefully');
    }
    await imageQueue.close();
    logger.info('Image queue closed gracefully');
  } catch (err) {
    logger.error('Error closing image queue', { error: err.message });
  }
}

module.exports = {
  imageQueue,
  startImageWorker,
  queueImageGeneration,
  getQueueStats,
  closeImageQueue,
};
