'use strict';

/**
 * AIService
 *
 * Wraps the OpenAI SDK. Responsibilities:
 *   - Chat completions (with full context window)
 *   - Summarisation calls (condensed, cheap model)
 *   - Memory extraction calls
 *   - Token usage tracking
 *   - Error classification (rate limit vs. API error vs. content filter)
 *   - Response post-processing (trim, sanitise HTML)
 *
 * Design decisions:
 *   - We use a single OpenAI instance (singleton) to reuse TCP connections.
 *   - Summarisation uses gpt-4o-mini to keep costs low — summaries don't
 *     need the full model's capability.
 *   - We never stream to the database — we await the full response, then
 *     save. Streaming to Telegram (typing indicator) is simulated via
 *     sendTyping() which runs concurrently.
 */

const OpenAI  = require('openai');
const config  = require('../../config/env');
const logger  = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const {
  buildSystemPrompt,
  buildSummarisationPrompt,
  buildMemoryExtractionPrompt,
} = require('./promptBuilder');

// ---------------------------------------------------------------------------
// Singleton OpenAI client
// ---------------------------------------------------------------------------
const openai = new OpenAI({ apiKey: config.openai.apiKey });

// Model for cheap utility calls (summarisation, memory extraction)
const UTILITY_MODEL = 'gpt-4o-mini';

// ---------------------------------------------------------------------------
// Chat completion
// ---------------------------------------------------------------------------

/**
 * Generate an AI chat response.
 *
 * @param {object} options
 * @param {object} options.personality   — personality document
 * @param {object} options.user          — User document
 * @param {Array}  options.contextMessages — [{ role, content }, ...]
 * @param {string} options.userMessage   — the latest user message
 * @param {string} options.summary       — conversation summary (may be null)
 * @param {object} options.settings      — AdminSettings document
 * @param {number} options.memoryLimit   — max memories to inject
 *
 * @returns {{ content: string, tokenUsage: object, model: string }}
 */
async function generateChatResponse({
  personality,
  user,
  contextMessages,
  userMessage,
  summary,
  settings,
  memoryLimit,
}) {
  // Build system prompt with memories injected
  const systemPrompt = await buildSystemPrompt({
    personality,
    user,
    summary,
    memoryLimit,
  });

  // Assemble the messages array for OpenAI
  // Format: [system, ...history, user_latest]
  const messages = [
    { role: 'system', content: systemPrompt },
    ...contextMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  const model       = settings?.aiModel       || config.openai.model;
  const maxTokens   = settings?.aiMaxTokens   || config.openai.maxTokens;
  const temperature = settings?.aiTemperature || config.openai.temperature;

  try {
    logger.info('OpenAI chat request', {
      telegramId: user.telegramId,
      model,
      messageCount: messages.length,
      personality: personality.key,
    });

    const response = await openai.chat.completions.create({
      model,
      messages,
      max_tokens:  maxTokens,
      temperature,
      // Prevent the model from refusing roleplay by not over-constraining
      presence_penalty:  0.6,  // encourage varied responses
      frequency_penalty: 0.3,  // reduce repetitive phrases
    });

    const choice     = response.choices[0];
    const content    = choice.message.content?.trim() || '';
    const tokenUsage = {
      promptTokens:     response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens:      response.usage.total_tokens,
    };

    logger.info('OpenAI chat response', {
      telegramId: user.telegramId,
      tokens: tokenUsage.totalTokens,
      finishReason: choice.finish_reason,
    });

    return { content, tokenUsage, model };

  } catch (err) {
    return handleOpenAIError(err, 'chat completion');
  }
}

// ---------------------------------------------------------------------------
// Summarisation
// ---------------------------------------------------------------------------

/**
 * Summarise a batch of messages into a short paragraph.
 * Uses the cheap utility model to keep costs low.
 *
 * @param {Array}  messages        — [{ role, content }]
 * @param {string} existingSummary — previous summary to extend
 * @param {string} displayName     — user's display name
 * @returns {string} summary text
 */
async function summariseConversation(messages, existingSummary, displayName) {
  const prompt = buildSummarisationPrompt(messages, existingSummary, displayName);

  try {
    const response = await openai.chat.completions.create({
      model: UTILITY_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 300,
      temperature: 0.3, // low temperature for factual summary
    });

    return response.choices[0].message.content?.trim() || '';
  } catch (err) {
    logger.error('Summarisation OpenAI call failed', { error: err.message });
    return existingSummary || ''; // fall back to previous summary
  }
}

// ---------------------------------------------------------------------------
// Memory extraction
// ---------------------------------------------------------------------------

/**
 * Extract factual memories from recent messages.
 * Returns parsed array of memory objects, or empty array on failure.
 *
 * @param {Array}  messages    — [{ role, content }]
 * @param {string} displayName
 * @returns {Array<{ content, category, importance, confidence }>}
 */
async function extractMemories(messages, displayName) {
  const prompt = buildMemoryExtractionPrompt(messages, displayName);

  try {
    const response = await openai.chat.completions.create({
      model: UTILITY_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.1, // very low — we want deterministic extraction
      response_format: { type: 'json_object' },
    });

    const raw  = response.choices[0].message.content?.trim() || '[]';

    // The model may return { memories: [...] } or just [...] — handle both
    let parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      parsed = parsed.memories || parsed.facts || Object.values(parsed)[0] || [];
    }

    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.error('Memory extraction failed', { error: err.message });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

/**
 * Classify OpenAI errors and throw appropriate AppErrors.
 */
function handleOpenAIError(err, context) {
  const { captureError } = require('../../utils/sentryHelper');

  logger.error(`OpenAI error in ${context}`, {
    status: err.status,
    code:   err.code,
    error:  err.message,
  });

  // Only capture unexpected errors in Sentry — not rate limits or content filters
  if (err.status !== 429 && err.status !== 400) {
    captureError(err, { context, status: err.status, code: err.code });
  }

  if (err.status === 429) {
    throw new AppError(
      'AI is a bit busy right now. Please try again in a moment! 🙏',
      429
    );
  }

  if (err.status === 400 && err.code === 'context_length_exceeded') {
    throw new AppError(
      'Our conversation got very long! Use /reset to start fresh. 🔄',
      400
    );
  }

  if (err.status === 400) {
    throw new AppError(
      "I can't respond to that particular message. Try rephrasing? 💭",
      400
    );
  }

  // Generic fallback
  throw new AppError(
    "My thoughts got a bit scrambled! Give me a moment and try again. 😅",
    500
  );
}

module.exports = {
  generateChatResponse,
  summariseConversation,
  extractMemories,
};
