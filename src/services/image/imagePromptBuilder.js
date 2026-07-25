'use strict';

/**
 * ImagePromptBuilder
 *
 * Configures the image prompt format based on the companion details
 * and user message.
 */

const NEGATIVE_PROMPT =
  'nsfw, explicit, nude, sexual, violence, gore, ugly, deformed, blurry, ' +
  'low quality, watermark, text, logo, duplicate, morbid, mutilated, ' +
  'extra limbs, poorly drawn face, mutation, disfigured, bad anatomy';

const EXPLICIT_WORDS = /\b(nudes?|naked(ness|ly)?|underwear|bikinis?|lingerie|panties|bras?|asses?|boobs?|boobies?|breasts?|tits?|puss(y|ies)|vaginas?|cunts?|nipples?|clits?|clitoris|bottomless|sex|sexy|sensual|explicit|nsfw|seductive|revealing|boudoir|cleavage|hot|erotic|porn|xxx|butts?|thongs?|stockings?|g-strings?|tanga|bralettes?|babydoll|negligee|topless|nacked|undressed|strips?|stripping|naughty|humps?|fucks?|fucking|masturbat(e|ing|ion)|orgasms?|erogenous|fetishes?|kinky|bdsm|bondage|erotica|seduces?|seduction|sensually|erotical|voluptuous|peekaboo)\b/i;

/**
 * Build the prompt format for the image generator.
 *
 * @param {object} options
 * @param {string} options.userPrompt  — raw user message
 * @param {object} options.personality — personality schema details
 * @returns {{ enhancedPrompt: string, negativePrompt: string }}
 */
function buildImagePrompt({ userPrompt, personality }) {
  const age = personality?.age || '23';
  const personalityStr = personality?.personality || 'Playful & Flirty'
  
  const girlfriendContext = `a ${age}-year-old attractive women girlfriend of him show some clevage, has personalities: ${personalityStr.toLowerCase()}`;
  const enhancedPrompt = `${girlfriendContext}, generate image according to: ${userPrompt}`;

  const isExplicit = EXPLICIT_WORDS.test(userPrompt) || EXPLICIT_WORDS.test(enhancedPrompt);
  const negativePrompt = isExplicit
    ? 'violence, gore, ugly, deformed, blurry, low quality, watermark, text, logo, duplicate, morbid, mutilated, extra limbs, poorly drawn face, mutation, disfigured, bad anatomy'
    : NEGATIVE_PROMPT;

  return {
    enhancedPrompt,
    negativePrompt,
  };
}

module.exports = { buildImagePrompt };
