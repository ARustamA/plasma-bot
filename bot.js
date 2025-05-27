const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const path = require('path');
const debug = require('debug')('bot');
const fs = require('fs');

// Модули
const { BOT_TOKEN } = require('./config');
const { canDonatePlasma, getMonthName } = require('./utils/dates');
const { checkAvailability, startBooking } = require('./handlers/booking');
const { bookAppointment } = require('./services/donor-form');
const { requestManualCaptcha } = require('./utils/captcha');

// Создаем бота
const bot = new Telegraf(BOT_TOKEN);
bot.use(new LocalSession({ database: 'sessions.json' }).middleware());

let intervalId = null;

// === Команды управления ===

bot.command('startcheck', (ctx) => {
  if (!ctx.session.checkingEnabled) {
    ctx.session.checkingEnabled = true;
    startPeriodicCheck();
    ctx.reply('Фоновая проверка снова активна.');
  } else {
    ctx.reply('Фоновая проверка уже работает.');
  }
});

bot.command('stopcheck', (ctx) => {
  stopPeriodicCheck();
  ctx.session.checkingEnabled = false;
  ctx.reply('Фоновая проверка остановлена.');
});

bot.command('status', (ctx) => {
  const status = ctx.session.checkingEnabled !== false ? 'активна' : 'остановлена';
  ctx.reply(`Фоновая проверка: ${status}.`);
});

bot.telegram.setMyCommands([
  { command: '/start', description: 'Начать работу с ботом' },
  { command: '/startcheck', description: 'Включить автоматическую проверку дат' },
  { command: '/stopcheck', description: 'Остановить автоматическую проверку дат' },
  { command: '/status', description: 'Показать статус фоновой проверки' },
  { command: '/testcaptcha', description: 'Протестировать распознавание капчи' }
]);

// === Логика старта и проверки ===
bot.start(async (ctx) => {
  try {
    console.log('Команда /start вызвана');
    console.log('Сессия:', ctx.session);

    // Инициализируем сессию если её нет
    if (!ctx.session) {
      ctx.session = {};
    }

    if (!ctx.session.lastDonationDate || !ctx.session.donationType) {
      ctx.session.state = 'ask_donation_type';
      await ctx.reply('Здравствуйте! Расскажите немного о себе:');
      await ctx.reply('Что вы сдавали в последний раз?',
        Markup.inlineKeyboard([
          [Markup.button.callback('🩸 Кровь', 'donation_type_blood')],
          [Markup.button.callback('🧪 Плазма', 'donation_type_plasma')]
        ])
      );
      return;
    }

    const canDonate = canDonatePlasma(ctx.session.lastDonationDate, ctx.session.donationType);

    if (!canDonate) {
      const lastDate = new Date(ctx.session.lastDonationDate);
      const waitDays = ctx.session.donationType === 'blood' ? 30 : 14;
      const nextPossibleDate = new Date(lastDate.getTime() + waitDays * 24 * 60 * 60 * 1000);
      await ctx.reply(`Вы можете записаться на плазму не раньше ${nextPossibleDate.toLocaleDateString()}.`);
      return;
    }

    if (ctx.session.checkingEnabled !== false) {
      ctx.session.checkingEnabled = true;
      startPeriodicCheck();
    }

    // Выполняем единоразовую проверку с дополнительной обработкой ошибок
    try {
      await checkAvailability(ctx);
    } catch (checkError) {
      console.error('Ошибка при проверке доступности:', checkError);
      await ctx.reply('🌐 Не удалось проверить доступные даты. Сайт может быть временно недоступен.');
    }

  } catch (error) {
    console.error('Ошибка в команде /start:', error);
    await ctx.reply('Произошла ошибка. Попробуйте ещё раз.');
  }
});

// === Обработчики кнопок ===

// Обработчик выбора типа донации
bot.action(/donation_type_(.*)/, async (ctx) => {
  const donationType = ctx.match[1];
  ctx.session.donationType = donationType;
  ctx.session.state = 'ask_last_donation_date';

  const typeText = donationType === 'blood' ? 'кровь' : 'плазму';
  await ctx.editMessageText(`✅ Выбрано: ${typeText}\n\nКогда была последняя сдача? (формат: ДД.ММ.ГГГГ)`);
});

bot.action(/select_date_(.*)/, async (ctx) => {
  const selectedDate = ctx.match[1];
  ctx.session.selectedDate = selectedDate;

  // Преобразуем дату для красивого отображения
  const date = new Date(selectedDate);
  const displayDate = `${date.getDate()} ${getMonthName(date.getMonth())}`;

  await ctx.editMessageText(`✅ Выбрана дата: ${displayDate}\n🔍 Ищу свободное время...`);
  await startBooking(ctx);
});

bot.action(/select_time_(.*)/, async (ctx) => {
  const selectedTime = ctx.match[1];
  ctx.session.selectedTime = selectedTime;

  const date = new Date(ctx.session.selectedDate);
  const displayDate = `${date.getDate()} ${getMonthName(date.getMonth())}`;

  await ctx.editMessageText(`✅ Выбрано время: ${selectedTime}\n📅 Дата: ${displayDate}\n\nПодтвердить запись?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Да, записать', 'confirm_booking_yes')],
      [Markup.button.callback('❌ Нет, отменить', 'confirm_booking_no')]
    ])
  );
});
// Добавьте эту команду в bot.js для тестирования капчи
bot.command('testcaptcha', async (ctx) => {
  await ctx.reply('🔍 Тестирую распознавание капчи...');

  try {
    // Используем функцию testCaptchaFromBot для автоматического распознавания
    const recognizedText = await testCaptchaFromBot();

    if (recognizedText && recognizedText.length > 0) {
      await ctx.reply(`✅ Капча распознана автоматически: "${recognizedText}"`);
    } else {
      await ctx.reply('❌ Не удалось автоматически распознать капчу');
    }

    // Также тестируем ручной ввод капчи
    const { chromium } = require('playwright');
    let browser;

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');

    // Закрываем модальное окно
    try {
      await page.waitForSelector('.donorform-modal', { timeout: 5000 });
      await page.click('.js-donorform-modal-close');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('Модальное окно не найдено');
    }

    // Получаем капчу для ручного ввода
    await page.waitForSelector('.captcha_item img', { timeout: 10000 });
    const captchaElement = await page.locator('.captcha_item img').first();

    const testDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const captchaPath = path.join(testDir, `test_captcha_${Date.now()}.png`);
    await captchaElement.screenshot({ path: captchaPath });

    // Отправляем капчу пользователю для ручного ввода
    await ctx.reply('📷 Тестирую также ручной ввод капчи:');
    await requestManualCaptcha(ctx, captchaPath);

    await browser.close();

  } catch (error) {
    console.error('Ошибка тестирования капчи:', error);
    await ctx.reply('❌ Ошибка при тестировании капчи');
  }
});

async function testCaptchaFromBot() {
  const { chromium } = require('playwright');
  const sharp = require('sharp');
  const Tesseract = require('tesseract.js');

  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');

    // Закрываем модальное окно если есть
    try {
      await page.waitForSelector('.donorform-modal', { timeout: 5000 });
      await page.click('.js-donorform-modal-close');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('Модальное окно не найдено');
    }

    await page.waitForSelector('.captcha_item img', { timeout: 10000 });

    const captchaElement = await page.locator('.captcha_item img').first();
    const captchaPath = path.join(__dirname, 'temp', `test_captcha_${Date.now()}.png`);

    // Создаем папку temp если её нет
    const tempDir = path.dirname(captchaPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    await captchaElement.screenshot({ path: captchaPath });

    // Обрабатываем изображение для лучшего распознавания
    const processedPath = captchaPath.replace('.png', '_processed.png');
    await sharp(captchaPath)
      .greyscale()
      .threshold(128)
      .resize(200, 80)
      .png()
      .toFile(processedPath);

    // Распознаем текст с капчи
    const { data: { text, confidence } } = await Tesseract.recognize(processedPath, 'eng', {
      logger: m => console.log(m) // Логируем процесс распознавания
    });

    const cleanText = text.replace(/[^a-zA-Z0-9]/g, '').trim();

    console.log(`Распознанный текст: "${cleanText}", уверенность: ${confidence}%`);

    // Удаляем временные файлы
    if (fs.existsSync(captchaPath)) fs.unlinkSync(captchaPath);
    if (fs.existsSync(processedPath)) fs.unlinkSync(processedPath);

    return cleanText;

  } catch (error) {
    console.error('Ошибка при автоматическом распознавании капчи:', error);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Обработчик отмены ввода капчи
bot.action('cancel_captcha', async (ctx) => {
  // Очищаем состояние капчи
  ctx.session.state = 'ready';
  delete ctx.session.manualCaptchaText;

  // Удаляем файл капчи если он есть
  if (ctx.session.currentCaptchaPath && fs.existsSync(ctx.session.currentCaptchaPath)) {
    fs.unlinkSync(ctx.session.currentCaptchaPath);
    delete ctx.session.currentCaptchaPath;
  }

  await ctx.editMessageText(
    '❌ *Запись отменена*\n\n' +
    '💡 Вы можете выбрать другое время или дату для записи.',
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🔙 К выбору дат', 'back_to_dates')]
      ])
    }
  );
});
// Обработчик подтверждения записи
bot.action(/confirm_booking_(.*)/, async (ctx) => {
  const confirmation = ctx.match[1];

  if (confirmation === 'yes') {
    await ctx.editMessageText('🔄 Начинаю запись...');
    // Передаем функцию requestManualCaptcha в bookAppointment
    await bookAppointment(ctx, requestManualCaptcha);
  } else {
    await ctx.editMessageText('❌ Запись отменена. Я продолжу проверять новые даты.');
  }
});

// === Опрос пользователя ===

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const state = ctx.session.state;

  // ОБРАБОТКА ВВОДА КАПЧИ
  if (state === 'waiting_captcha_input') {
    const captchaText = text.trim();

    if (captchaText.length < 3) {
      await ctx.reply('❌ Слишком короткий текст. Пожалуйста, введите текст с картинки:');
      return;
    }

    ctx.session.manualCaptchaText = captchaText;
    ctx.session.state = 'captcha_received';

    await ctx.reply(`✅ Капча получена: "${captchaText}"\n🔄 Отправляю форму...`);

    // Удаляем файл капчи если он есть
    if (ctx.session.currentCaptchaPath && fs.existsSync(ctx.session.currentCaptchaPath)) {
      fs.unlinkSync(ctx.session.currentCaptchaPath);
      delete ctx.session.currentCaptchaPath;
    }

    // Продолжаем процесс записи с введенной капчей
    await bookAppointment(ctx, requestManualCaptcha);
    return;
  }

  // Обработка текстовых ответов для сбора данных пользователя
  if (state === 'ask_last_donation_date') {
    const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) {
      const [_, day, month, year] = match;
      const dateStr = `${year}-${month}-${day}`;
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        ctx.session.lastDonationDate = dateStr;
        ctx.session.state = 'ask_name';
        await ctx.reply('✅ Дата сохранена!\n\nВведите ваше ФИО:');
      } else {
        await ctx.reply('❌ Неверная дата. Попробуйте ещё раз в формате ДД.ММ.ГГГГ');
      }
    } else {
      await ctx.reply('❌ Формат даты должен быть: ДД.ММ.ГГГГ\nНапример: 15.03.2024');
    }
  } else if (ctx.session.state === 'ask_name') {
    ctx.session.donorData = ctx.session.donorData || {};
    ctx.session.donorData.name = text;
    ctx.session.state = 'ask_phone';
    await ctx.reply('✅ ФИО сохранено!\n\nВведите ваш телефон:');
  } else if (ctx.session.state === 'ask_phone') {
    ctx.session.donorData.phone = text;
    ctx.session.state = 'ask_email';
    await ctx.reply('✅ Телефон сохранен!\n\nВведите ваш email:');
  } else if (ctx.session.state === 'ask_email') {
    ctx.session.donorData.email = text;
    ctx.session.state = 'ask_birth_date';
    await ctx.reply('✅ Email сохранен!\n\nДата рождения (ДД.ММ.ГГГГ):');
  } else if (ctx.session.state === 'ask_birth_date') {
    const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) {
      const [_, day, month, year] = match;
      ctx.session.donorData.birthDate = `${year}-${month}-${day}`;
      ctx.session.state = 'ask_snils';
      await ctx.reply('✅ Дата рождения сохранена!\n\nВведите ваш СНИЛС:');
    } else {
      await ctx.reply('❌ Формат даты должен быть: ДД.ММ.ГГГГ');
    }
  } else if (ctx.session.state === 'ask_snils') {
    ctx.session.donorData.snils = text;
    ctx.session.state = 'ready';

    const nextPossibleDate = new Date(ctx.session.lastDonationDate);
    if (ctx.session.donationType === 'blood') {
      nextPossibleDate.setDate(nextPossibleDate.getDate() + 30);
    } else {
      nextPossibleDate.setDate(nextPossibleDate.getDate() + 14);
    }

    await ctx.reply(`✅ Спасибо за регистрацию!

📋 Ваши данные сохранены:
👤 ФИО: ${ctx.session.donorData.name}
📞 Телефон: ${ctx.session.donorData.phone}
📧 Email: ${ctx.session.donorData.email}

🩸 Вы можете снова сдавать плазму после ${nextPossibleDate.toLocaleDateString()}.
🔍 Я буду следить за доступными датами и уведомлю вас!`);

    await checkAvailability(ctx);
  } else {
    await ctx.reply('❓ Не понял команду. Пожалуйста, следуйте инструкциям выше.');
  }
});

// Добавьте эту команду в bot.js для тестирования капчи
bot.command('testcaptcha', async (ctx) => {
  await ctx.reply('🔍 Тестирую отправку капчи...');

  try {
    const { chromium } = require('playwright');
    let browser;

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');

    // Закрываем модальное окно
    try {
      await page.waitForSelector('.donorform-modal', { timeout: 5000 });
      await page.click('.js-donorform-modal-close');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('Модальное окно не найдено');
    }

    // Получаем капчу
    await page.waitForSelector('.captcha_item img', { timeout: 10000 });
    const captchaElement = await page.locator('.captcha_item img').first();

    const testDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const captchaPath = path.join(testDir, `test_captcha_${Date.now()}.png`);
    await captchaElement.screenshot({ path: captchaPath });

    // Отправляем капчу пользователю
    await requestManualCaptcha(ctx, captchaPath);

    await browser.close();

  } catch (error) {
    console.error('Ошибка тестирования капчи:', error);
    await ctx.reply('❌ Ошибка при тестировании капчи');
  }
});

// async function testCaptchaFromBot() {
//   const { chromium } = require('playwright');
//   const sharp = require('sharp');
//   const Tesseract = require('tesseract.js');

//   let browser;

//   try {
//     browser = await chromium.launch({ headless: true });
//     const page = await browser.newPage();

//     await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');
//     await page.waitForSelector('.captcha_item img', { timeout: 10000 });

//     const captchaElement = await page.locator('.captcha_item img').first();
//     const captchaPath = path.join(__dirname, 'temp', `test_captcha_${Date.now()}.png`);

//     // Создаем папку temp если её нет
//     const tempDir = path.dirname(captchaPath);
//     if (!fs.existsSync(tempDir)) {
//       fs.mkdirSync(tempDir, { recursive: true });
//     }

//     await captchaElement.screenshot({ path: captchaPath });

//     // Обрабатываем изображение
//     const processedPath = captchaPath.replace('.png', '_processed.png');
//     await sharp(captchaPath)
//       .greyscale()
//       .threshold(128)
//       .resize(200, 80)
//       .png()
//       .toFile(processedPath);

//     // Распознаем
//     const { data: { text, confidence } } = await Tesseract.recognize(processedPath, 'eng');
//     const cleanText = text.replace(/[^a-zA-Z0-9]/g, '').trim();

//     console.log(`Распознанный текст: "${cleanText}", уверенность: ${confidence}%`);

//     // Удаляем временные файлы
//     if (fs.existsSync(captchaPath)) fs.unlinkSync(captchaPath);
//     if (fs.existsSync(processedPath)) fs.unlinkSync(processedPath);

//     return cleanText;

//   } finally {
//     if (browser) {
//       await browser.close();
//     }
//   }
// }

// === Фоновая проверка дат ===

function startPeriodicCheck() {
  if (intervalId) return;

  intervalId = setInterval(async () => {
    const chatId = process.env.TELEGRAM_USER_ID;
    const context = { chat: { id: chatId }, session: {} };
    try {
      await checkAvailability(context);
    } catch (e) {
      console.error('Ошибка при периодической проверке:', e);
    }
  }, 60 * 60 * 1000); // Раз в час
}

function stopPeriodicCheck() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

bot.catch((err, ctx) => {
  console.error('Ошибка в боте:', err);
  if (ctx) {
    ctx.reply('Произошла ошибка. Попробуйте позже.').catch(console.error);
  }
});

// === Экспорт функции для использования в других модулях ===
module.exports = { requestManualCaptcha };

// === Запуск бота ===

bot.launch();
debug('Telegram бот запущен.');
