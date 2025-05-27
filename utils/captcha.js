const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs');
const { Markup } = require('telegraf'); // Добавить импорт

async function recognizeCaptcha(imagePath) {
  try {
    const sharp = require('sharp');
    const Tesseract = require('tesseract.js');

    // Обрабатываем изображение для лучшего распознавания
    const processedImagePath = imagePath.replace('.png', '_processed.png');

    await sharp(imagePath)
      .greyscale()
      .threshold(128)
      .resize(200, 80)
      .png()
      .toFile(processedImagePath);

    // Распознаем текст
    const { data: { text } } = await Tesseract.recognize(processedImagePath, 'eng', {
      logger: m => console.log(m)
    });

    // Очищаем результат
    const cleanText = text.replace(/[^a-zA-Z0-9]/g, '').trim();

    // Удаляем обработанное изображение
    if (fs.existsSync(processedImagePath)) {
      fs.unlinkSync(processedImagePath);
    }

    return cleanText;
  } catch (error) {
    console.error('Ошибка распознавания капчи:', error);
    return '';
  }
}

async function cropCaptcha(fullPageImage) {
  try {
    const width = 150;
    const height = 50;
    const x = 300;
    const y = 800;

    return await sharp(fullPageImage)
      .extract({ width, height, left: x, top: y })
      .toBuffer();
  } catch (error) {
    console.error('Ошибка обрезки капчи:', error);
    return null;
  }
}

async function requestManualCaptcha(ctx, captchaImagePath) {
  try {
    console.log('Отправляем капчу пользователю для ручного ввода...');

    // Проверяем, что файл существует
    if (!fs.existsSync(captchaImagePath)) {
      throw new Error('Файл капчи не найден');
    }

    // Отправляем изображение капчи пользователю с улучшенным интерфейсом
    await ctx.replyWithPhoto(
      { source: captchaImagePath },
      {
        caption: '🔤 *Подтверждение записи*\n\n' +
          '📝 Пожалуйста, введите текст с картинки для завершения записи.\n' +
          '💡 Обычно это 4-6 символов (буквы и цифры).',
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('❌ Отменить запись', 'cancel_captcha')]
        ])
      }
    );

    // Устанавливаем состояние ожидания ввода капчи
    ctx.session.state = 'waiting_captcha_input';

    console.log('Капча отправлена пользователю, ожидаем ввод...');

  } catch (error) {
    console.error('Ошибка при отправке капчи:', error);
    await ctx.reply(
      '❌ *Ошибка при отправке капчи*\n\n' +
      '🔧 Возможно, временные технические проблемы.\n' +
      '💡 Попробуйте записаться позже.',
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 К выбору дат', 'back_to_dates')]
        ])
      }
    );
  }
}

module.exports = { recognizeCaptcha, cropCaptcha, requestManualCaptcha };
