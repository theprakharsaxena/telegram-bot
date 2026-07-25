'use strict';

const { sendMessage, sendPhoto } = require('../../services/bot/telegramService');
const { Video } = require('../../models');

async function videosCommand(msg) {
  const { user, chatId } = msg._ctx;
  const isPremium = user.isPremium;

  try {
    const videos = await Video.find({}).sort({ createdAt: -1 });

    if (videos.length === 0) {
      await sendMessage(chatId, '🎬 <b>Premium Video Gallery</b>\n\nNo videos have been uploaded yet. Check back soon! 💋');
      return;
    }

    await sendMessage(chatId, `🎬 <b>Premium Video Gallery</b>\n\nHere are the latest uncensored videos of your girlfriends! 🔥\nTotal videos: <b>${videos.length}</b>`);

    for (const video of videos) {
      if (isPremium) {
        // Premium user gets direct links
        const text = `🔥 <b>${video.title}</b>\n\n` +
                     `🔗 <b>Direct Link:</b>\n${video.url}`;

        const replyMarkup = {
          inline_keyboard: [
            [
              { text: '🍿 Watch Uncensored', url: video.url }
            ]
          ]
        };

        await sendPhoto(chatId, video.thumbnailUrl, {
          caption: text,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        }).catch(async (err) => {
          // Fallback to text message if photo sending fails
          await sendMessage(chatId, `${text}`, { reply_markup: replyMarkup });
        });
      } else {
        // Free user gets blurred preview image and locked URL
        const lockedText = `🔒 <b>${video.title}</b> [Locked]\n\n` +
                           `⚠️ <i>This explicit uncensored video is only available for VIP members!</i>`;

        // Use a heavily blurred variant of the thumbnail as placeholder (or fallback blurred placeholder)
        let previewImage = video.thumbnailUrl;
        if (previewImage.includes('unsplash.com')) {
          previewImage += previewImage.includes('?') ? '&blur=80' : '?blur=80';
        } else {
          // Fallback locked placeholder image
          previewImage = 'https://img.freepik.com/free-vector/gradient-locked-premium-content-concept_23-2149179836.jpg';
        }

        const replyMarkup = {
          inline_keyboard: [
            [
              { text: '⭐ Go Premium to Unlock 🔞', callback_data: 'action:premium' }
            ]
          ]
        };

        await sendPhoto(chatId, previewImage, {
          caption: lockedText,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        }).catch(async (err) => {
          await sendMessage(chatId, `${lockedText}`, { reply_markup: replyMarkup });
        });
      }
    }
  } catch (err) {
    await sendMessage(chatId, '😔 Failed to load video gallery. Please try again later.');
  }
}

module.exports = { videosCommand };
