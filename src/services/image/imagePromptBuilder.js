'use strict';

/**
 * ImagePromptBuilder
 *
 * Transforms a raw user request ("send me a selfie") into a rich,
 * detailed Replicate SDXL prompt optimised for photo-realistic output.
 *
 * Layers applied:
 *   1. Base quality boosters     — always appended
 *   2. Personality style hints   — from AdminSettings
 *   3. Scene classification      — selfie vs. together vs. place vs. generic
 *   4. Negative prompt           — universal safety + quality filters
 */

const QUALITY_BOOSTERS =
  'highly detailed, photorealistic, 8k resolution, professional photography, ' +
  'sharp focus, beautiful lighting, high quality';

const NEGATIVE_PROMPT =
  'nsfw, explicit, nude, sexual, violence, gore, ugly, deformed, blurry, ' +
  'low quality, watermark, text, logo, duplicate, morbid, mutilated, ' +
  'extra limbs, poorly drawn face, mutation, disfigured, bad anatomy';

// Scene-specific prompt injections
const SCENE_TEMPLATES = {
  selfie: (name, style) =>
    `portrait photo of a beautiful young woman named ${name}, ` +
    `taking a selfie, ${style}, warm smile, natural makeup, `,

  together: (name, style) =>
    `two people together, a beautiful young woman named ${name} and a person, ` +
    `${style}, happy, close together, warm atmosphere, `,

  place: (name, style, place) =>
    `beautiful young woman named ${name} at ${place}, ` +
    `${style}, travel photography, stunning scenery, `,

  generic: (name, style) =>
    `portrait of a beautiful young woman named ${name}, ` +
    `${style}, `,
};

// Keywords that hint at each scene type
const SCENE_KEYWORDS = {
  together: ['us', 'together', 'both', 'we ', 'our '],
  selfie:   ['selfie', 'photo of you', 'picture of you', 'yourself'],
  place:    ['beach', 'park', 'paris', 'london', 'tokyo', 'mountain', 'ocean',
             'forest', 'city', 'cafe', 'restaurant', 'vacation', 'travel'],
};

/**
 * Detect scene type from the user's prompt.
 * @param {string} text — cleaned user prompt
 * @returns {{ scene: string, place: string|null }}
 */
function detectScene(text) {
  const lower = text.toLowerCase();

  for (const keyword of SCENE_KEYWORDS.together) {
    if (lower.includes(keyword)) return { scene: 'together', place: null };
  }

  for (const keyword of SCENE_KEYWORDS.selfie) {
    if (lower.includes(keyword)) return { scene: 'selfie', place: null };
  }

  for (const keyword of SCENE_KEYWORDS.place) {
    if (lower.includes(keyword)) return { scene: 'place', place: keyword };
  }

  return { scene: 'generic', place: null };
}

/**
 * Build the enhanced positive prompt for Replicate SDXL.
 *
 * @param {object} options
 * @param {string} options.userPrompt       — raw user request (already cleaned)
 * @param {object} options.personality      — personality document from AdminSettings
 * @param {string} options.personalityName  — display name e.g. 'Luna'
 * @returns {{ enhancedPrompt: string, negativePrompt: string }}
 */
function buildImagePrompt({ userPrompt, personality, personalityName }) {
  const styleHint = personality?.imageStylePrompt || 'soft aesthetic, natural lighting';
  const name      = personalityName || personality?.name || 'Sarah';

  const { scene, place } = detectScene(userPrompt);

  let scenePrefix;
  switch (scene) {
    case 'selfie':
      scenePrefix = SCENE_TEMPLATES.selfie(name, styleHint);
      break;
    case 'together':
      scenePrefix = SCENE_TEMPLATES.together(name, styleHint);
      break;
    case 'place':
      scenePrefix = SCENE_TEMPLATES.place(name, styleHint, place);
      break;
    default:
      scenePrefix = SCENE_TEMPLATES.generic(name, styleHint);
  }

  // Append quality boosters
  const enhancedPrompt = `${scenePrefix}${QUALITY_BOOSTERS}`;

  return {
    enhancedPrompt,
    negativePrompt: NEGATIVE_PROMPT,
  };
}

module.exports = { buildImagePrompt, detectScene };
