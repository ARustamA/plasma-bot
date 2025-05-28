const { Markup } = require('telegraf');
const fs = require('fs');

async function requestManualCaptcha(ctx, captchaImagePath) {
  try {
    console.log('Отправляем капчу пользователю:', captchaImagePath);

    // Устанавливаем состояние ожидания ввода капчи
    ctx.session.state = 'waiting_captcha_input';

    // Отправляем изображение капчи пользователю
    await ctx.replyWithPhoto(
      { source: captchaImagePath },
      {
        caption: '🔤 *Введите текст с картинки*\n\n' +
          '💡 Внимательно посмотрите на символы и введите их текстом.\n' +
          '⚠️ Учитывайте регистр букв!',
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('❌ Отменить запись', 'cancel_captcha')]
        ])
      }
    );

    console.log('Капча отправлена пользователю, ожидаем ввода...');

  } catch (error) {
    console.error('Ошибка при отправке капчи:', error);

    // Удаляем файл в случае ошибки
    if (fs.existsSync(captchaImagePath)) {
      fs.unlinkSync(captchaImagePath);
    }

    throw error;
  }
}

module.exports = {
  requestManualCaptcha
};
