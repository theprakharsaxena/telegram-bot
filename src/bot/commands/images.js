'use strict';

/**
 * /images Command Handler
 *
 * Shows the user's image generation history.
 * Sends up to 5 recent images as a media group (album),
 * followed by a summary message with stats and navigation.
 *
 * Why a media group (album)?
 *   Telegram groups up to 10 photos into a single swipeable album.
 *   Much cleaner UX than sending one message per image.
 */

const { getBot }        = require('../../services/bot/telegramService');
const { sendMessage }   = require('../../services/bot/telegramService');
const { getImageHistory } = require('../../services/image/imageService');
const { GeneratedImage }  = require('../../models');

async function imagesCommand(msg) {
  const { user, chatId } = msg._ctx;

  // Fetch last 5 succeeded images
  const images = await getImageHistory(user._id, 5, 1);

  if (!images.length) {
    await sendMessage(
      chatId,
      `🖼️ <b>Your Image Gallery</b>\n\n` +
      `You haven't generated any images yet!\n\n` +
      `Just ask me to send you a photo:\n` +
      `<i>"Send me a selfie"</i>\n` +
      `<i>"Show us at the beach"</i>\n` +
      `<i>"Generate a birthday photo"</i>`
    );
    return;
  }

  // Get total count for stats
  const totalCount = await GeneratedImage.countDocuments({
    userId: user._id,
    status: 'succeeded',
  });

  // Send images as album (media group) using file_ids where available
  const mediaGroup = images.map((img, i) => ({
    type:      'photo',
    // Prefer Telegram file_id (instant re-send) over URL (re-download)
    media:     img.telegramFileId || img.imageUrl,
    caption:   i === 0
      ? `🖼️ Your last ${images.length} image${images.length > 1 ? 's' : ''} (${totalCount} total)`
      : undefined,
    parse_mode: i === 0 ? 'HTML' : undefined,
  }));

  try {
    const bot = getBot();
    await bot.sendMediaGroup(chatId, mediaGroup);
  } catch (err) {
    // If media group fails (e.g. expired URLs), fall back to text list
    const list = images
      .map((img, i) => `${i + 1}. <i>${img.userPrompt?.slice(0, 60) || 'Generated image'}</i>`)
      .join('\n');

    await sendMessage(
      chatId,
      `🖼️ <b>Your Recent Images</b>\n\n${list}\n\n` +
      `<i>Some image links may have expired. New images are always saved fresh.</i>`
    );
  }

  // Follow-up stats message
  await sendMessage(
    chatId,
    `📊 Total images generated: <b>${totalCount}</b>\n\n` +
    `Ask me to generate more anytime — just describe what you want to see!`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Check usage', callback_data: 'action:usage' }],
        ],
      },
    }
  );
}

module.exports = { imagesCommand };
