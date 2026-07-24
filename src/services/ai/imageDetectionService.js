'use strict';

/**
 * ImageDetectionService
 *
 * Determines whether a user message is requesting an AI-generated image.
 *
 * Two-tier detection:
 *   1. Fast regex patterns  — catches the most common explicit requests
 *      without an API call (zero latency, zero cost)
 *   2. Keyword scoring      — weighted word matching for natural language
 *      requests that bypass the regex
 *
 * We intentionally avoid using GPT for this classification — it would add
 * 200-400ms latency and cost tokens on every single message.
 *
 * Returns { isImageRequest: bool, confidence: 0-1, extractedPrompt: string|null }
 */

// ---------------------------------------------------------------------------
// Explicit image request patterns
// These are high-confidence triggers — any match → isImageRequest = true
// ---------------------------------------------------------------------------
const EXPLICIT_PATTERNS = [
  // Direct selfie/photo requests
  /\b(send|show|share)\s+(me\s+)?(a\s+)?(selfie|photo|pic|picture|image|photo of you)\b/i,
  // "take a photo/picture"
  /\btake\s+(a\s+)?(photo|picture|selfie|pic)\b/i,
  // "generate / create / make a photo/image"
  /\b(generate|create|make|draw|paint|render)\s+(a\s+|an\s+|me\s+a\s+)?(photo|image|picture|selfie|portrait|illustration)\b/i,
  // "imagine us at the beach" / "imagine you in Paris"
  /\bimagine\s+(us|you|yourself|me)\b/i,
  // "show us together" / "show yourself"
  /\bshow\s+(us\s+together|yourself|you|me\s+you)\b/i,
  // Direct: "can you send a pic", "send photo"
  /\bsend\s+(a\s+)?(pic|photo|image|selfie)\b/i,
  // "what do you look like" (reasonable to generate an image)
  /\bwhat\s+do\s+you\s+look\s+like\b/i,
];

// ---------------------------------------------------------------------------
// Scored keyword matching for natural-language image requests
// ---------------------------------------------------------------------------
const IMAGE_KEYWORDS = [
  { words: ['selfie', 'photo of you', 'picture of you'], score: 0.9 },
  { words: ['generate', 'create', 'make', 'draw', 'paint', 'render'], score: 0.4 },
  { words: ['image', 'picture', 'photo', 'pic', 'illustration', 'portrait'], score: 0.4 },
  { words: ['show me', 'send me', 'share'], score: 0.3 },
  { words: ['together', 'us', 'beach', 'park', 'vacation', 'birthday'], score: 0.2 },
  { words: ['look like', 'appearance', 'outfit', 'wearing'], score: 0.3 },
];

const KEYWORD_THRESHOLD = 0.75; // minimum score to classify as image request

// ---------------------------------------------------------------------------
// Main detection function
// ---------------------------------------------------------------------------

/**
 * Detect whether the message is requesting image generation.
 *
 * @param {string} text — raw user message
 * @returns {{ isImageRequest: boolean, confidence: number, extractedPrompt: string|null }}
 */
function detectImageRequest(text) {
  if (!text || typeof text !== 'string') {
    return { isImageRequest: false, confidence: 0, extractedPrompt: null };
  }

  const normalised = text.toLowerCase().trim();

  // ── Tier 1: Explicit pattern match ────────────────────────────────────────
  for (const pattern of EXPLICIT_PATTERNS) {
    if (pattern.test(normalised)) {
      return {
        isImageRequest: true,
        confidence:     0.95,
        extractedPrompt: cleanPrompt(text),
      };
    }
  }

  // ── Tier 2: Keyword scoring ───────────────────────────────────────────────
  let totalScore = 0;
  for (const { words, score } of IMAGE_KEYWORDS) {
    for (const word of words) {
      if (normalised.includes(word)) {
        totalScore += score;
        break; // only count each category once
      }
    }
  }

  if (totalScore >= KEYWORD_THRESHOLD) {
    return {
      isImageRequest: true,
      confidence:     Math.min(totalScore, 0.9),
      extractedPrompt: cleanPrompt(text),
    };
  }

  return { isImageRequest: false, confidence: totalScore, extractedPrompt: null };
}

/**
 * Clean the user's message into a usable image generation prompt.
 * Strips conversational filler, leaving the descriptive content.
 */
function cleanPrompt(text) {
  return text
    .replace(/^(hey|hi|hello|please|can you|could you|would you|i want|i'd like)\s+/i, '')
    .replace(/\?$/, '')
    .trim();
}

module.exports = { detectImageRequest };
