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

    await sendMessage(chatId, `🎬 <b>Premium Video Gallery</b>\n\nHere are the latest uncensored videos! 🔥`);

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

        // Dynamically blur the original thumbnail image using wsrv.nl proxy so it's the exact same image but blurred
        const previewImage = `https://wsrv.nl/?url=${encodeURIComponent(video.thumbnailUrl)}&blur=20`;

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
