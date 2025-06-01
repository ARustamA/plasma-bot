const { Markup } = require('telegraf');
const fs = require('fs');

async function requestManualCaptcha(ctx, captchaImagePath) {
  try {
    console.log('Отправляем капчу пользователю для ручного ввода...');

    // Устанавливаем состояние ожидания ввода капчи
    ctx.session.state = 'waiting_captcha_input';

    // Отправляем изображение капчи
    await ctx.replyWithPhoto(
      { source: captchaImagePath },
      {
        caption: '🔐 *Введите капчу с изображения*\n\n' +
          '💡 Внимательно посмотрите на картинку и введите текст, который видите.\n' +
          '📝 Обычно это 4-6 символов (буквы и цифры).',
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('❌ Отменить запись', 'cancel_captcha')]
        ])
      }
    );

    console.log('Капча отправлена пользователю');

  } catch (error) {
    console.error('Ошибка при отправке капчи:', error);

    // Удаляем файл если произошла ошибка
    if (fs.existsSync(captchaImagePath)) {
      try {
        fs.unlinkSync(captchaImagePath);
      } catch (e) {
        console.error('Ошибка при удалении файла капчи:', e);
      }
    }

    await ctx.reply(
      '❌ *Ошибка при отправке капчи*\n\n' +
      '🔧 Попробуйте позже или выберите другое время.',
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 К выбору дат', 'back_to_dates')]
        ])
      }
    );
  }
}


module.exports = {
  requestManualCaptcha
};
