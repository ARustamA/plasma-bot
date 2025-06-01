const { Markup } = require('telegraf');

async function handleTestCaptchaCommand(ctx) {
  ctx.session.state = 'testing_captcha';

  await ctx.reply(
    '🧪 *Тест ввода капчи*\n\n' +
    '📝 Введите любой текст для проверки работы системы ввода капчи.\n\n' +
    '💡 Это поможет убедиться, что бот правильно обрабатывает ваш ввод.',
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отменить тест', 'cancel_captcha_test')]
      ])
    }
  );
}

async function handleTestCaptchaInput(ctx, text) {
  const captchaText = text.trim();

  if (captchaText.length < 1) {
    await ctx.reply('❌ Пустой текст. Введите что-нибудь для теста:');
    return;
  }

  // Сбрасываем состояние теста
  ctx.session.state = 'ready';

  await ctx.reply(
    `✅ *Тест капчи успешен!*\n\n` +
    `📝 Вы ввели: "${captchaText}"\n` +
    `📏 Длина: ${captchaText.length} символов\n\n` +
    `🎉 Система ввода капчи работает корректно!`,
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🔙 В главное меню', 'back_to_main')]
      ])
    }
  );
}

// Обработчик отмены теста капчи
async function handleCaptchaTestCancel(ctx) {
  ctx.session.state = 'ready';

  await ctx.editMessageText(
    '❌ *Тест капчи отменен*\n\n' +
    '💡 Вы можете запустить тест снова командой /testcaptcha',
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🔙 В главное меню', 'back_to_main')]
      ])
    }
  );
}

module.exports = {
  handleTestCaptchaCommand,
  handleTestCaptchaInput,
  handleCaptchaTestCancel
};
