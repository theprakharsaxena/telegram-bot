'use strict';

/**
 * /usage Command Handler
 *
 * Shows today's usage with visual progress bars for messages and images.
 * Plan-aware: free users see an upgrade nudge when close to the limit.
 */

const { sendMessage } = require('../../services/bot/telegramService');
const usageService    = require('../../services/usage/usageService');
const config          = require('../../config/env');

async function usageCommand(msg) {
  const { user, chatId } = msg._ctx;
  const isPremium        = user.isPremium;

  // Get today's usage doc (read-only, cached)
  const usage    = await usageService.getTodayUsage(user.telegramId);
  const limits   = await usageService.getLimits();
  const planKey  = isPremium ? 'premium' : 'free';
  const planLimits = limits[planKey];

  const msgUsed  = usage?.messagesUsed  ?? 0;
  const imgUsed  = usage?.imagesUsed    ?? 0;
  const msgLimit = usage?.messageLimit  ?? planLimits.dailyMessages;
  const imgLimit = usage?.imageLimit    ?? planLimits.dailyImages;
  const resetAt  = usageService.getResetTime();

  // Calculate ad bonus
  const adBonusMsgs = user.adBonusMessages ?? 0;
  const adBonusImgs = user.adBonusImages ?? 0;
  const baseMsgLimit = msgLimit - adBonusMsgs;
  const baseImgLimit = imgLimit - adBonusImgs;

  // ── Visual progress bar ───────────────────────────────────────────────────
  function bar(used, limit, width = 12) {
    const pct    = limit > 0 ? Math.min(used / limit, 1) : 0;
    const filled = Math.round(pct * width);
    const empty  = width - filled;
    const colour = pct >= 1 ? '🟥' : pct >= 0.8 ? '🟨' : '🟩';
    return colour.repeat(filled) + '⬜'.repeat(empty);
  }

  // ── Warning thresholds ────────────────────────────────────────────────────
  const msgPct = msgLimit > 0 ? msgUsed / msgLimit : 0;
  const imgPct = imgLimit > 0 ? imgUsed / imgLimit : 0;

  const msgWarning = msgPct >= 1
    ? '  ⚠️ Limit reached!'
    : msgPct >= 0.8
    ? `  ⚠️ Nearly at limit!`
    : '';

  const imgWarning = imgPct >= 1
    ? '  ⚠️ Limit reached!'
    : imgPct >= 0.8
    ? `  ⚠️ Nearly at limit!`
    : '';

  const msgLimitLabel = isPremium ? 'Unlimited' : msgLimit;
  const msgWarningText = isPremium ? '' : msgWarning;

  const planBadge = isPremium ? '⭐ Premium' : '🆓 Free';

  // Build usage text with ad bonus breakdown
  let usageText =
    `📊 <b>Today's Usage</b>  ·  ${planBadge}\n\n` +

    `💬 <b>Messages</b>  ${msgUsed}/${msgLimitLabel}${msgWarningText}\n` +
    `${isPremium ? '🟩'.repeat(12) : bar(msgUsed, msgLimit)}\n`;

  if (!isPremium && (adBonusMsgs > 0 || adBonusImgs > 0)) {
    usageText += `🎬 <i>+${adBonusMsgs} bonus from ads</i>\n`;
  }
  usageText += '\n';

  usageText +=
    `🖼️ <b>Images</b>  ${imgUsed}/${imgLimit}${imgWarning}\n` +
    `${bar(imgUsed, imgLimit)}\n`;

  if (!isPremium && (adBonusMsgs > 0 || adBonusImgs > 0)) {
    usageText += `🎬 <i>+${adBonusImgs} bonus from ads</i>\n`;
  }
  usageText += '\n';

  usageText +=
    `⏰ Resets in <b>${resetAt}</b> (midnight UTC)\n` +

    (!isPremium
      ? `\n` +
        `⭐ <b>Go Premium</b> for Unlimited chat ` +
        `and ${config.limits.premium.dailyImages} images/day → /premium`
      : `\n✨ Enjoying your premium benefits!`);

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💬 Chat now',      callback_data: 'action:chat' },
        { text: '📈 Profile',       callback_data: 'action:profile' },
      ],
      ...(!isPremium ? [[{ text: '⭐ Upgrade to Premium', callback_data: 'action:premium' }]] : []),
    ],
  };

  await sendMessage(chatId, usageText, { reply_markup: keyboard });
}

module.exports = { usageCommand };
