const { Telegraf } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const debug = require('debug')('bot');
const fs = require('fs');

// Модули
const { BOT_TOKEN } = require('./config');
const { handleStartCommand, handleStartCheckCommand, handleStopCheckCommand, handleStatusCommand } = require('./handlers/commands');
const { handleDonationType, handleUserDataInput } = require('./handlers/userRegistration');
const { handleTestCaptchaCommand, handleTestCaptchaInput } = require('./handlers/captcha');
const { handleDateSelection, handleTimeSelection, handleBookingConfirmation,
  handleDateRefresh, handleTimeRefresh, handleCaptchaCancel } = require('./handlers/navigation');
const { requestManualCaptcha } = require('./utils/captcha');

const { bookAppointment } = require('./services/donor-form');

const PeriodicCheckService = require('./services/periodicCheck');

// Создаем бота
const bot = new Telegraf(BOT_TOKEN);
bot.use(new LocalSession({ database: 'sessions.json' }).middleware());

// Создаем сервис периодической проверки
const periodicCheckService = new PeriodicCheckService(bot);

// === Настройка команд ===
bot.telegram.setMyCommands([
  { command: '/start', description: 'Начать работу с ботом' },
  { command: '/startcheck', description: 'Включить автоматическую проверку дат' },
  { command: '/stopcheck', description: 'Остановить автоматическую проверку дат' },
  { command: '/status', description: 'Показать статус фоновой проверки' },
  { command: '/testcaptcha', description: 'Протестировать ввод капчи' }
]);

// === Команды ===
bot.command('start', (ctx) => handleStartCommand(ctx, () => periodicCheckService.start()));
bot.command('startcheck', (ctx) => handleStartCheckCommand(ctx, () => periodicCheckService.start()));
bot.command('stopcheck', (ctx) => handleStopCheckCommand(ctx, () => periodicCheckService.stop()));
bot.command('status', handleStatusCommand);
bot.command('testcaptcha', handleTestCaptchaCommand);

// === Обработчики действий ===
bot.action(/donation_type_(.*)/, (ctx) => handleDonationType(ctx, ctx.match[1]));
bot.action(/select_date_(.*)/, (ctx) => handleDateSelection(ctx, ctx.match[1]));
bot.action(/select_time_(.*)/, (ctx) => handleTimeSelection(ctx, ctx.match[1]));
bot.action(/confirm_booking_(.*)/, (ctx) => handleBookingConfirmation(ctx, ctx.match[1]));

// Обработчики навигации
bot.action('refresh_dates', (ctx) => {
  ctx.editMessageText('🔄 Обновляю список доступных дат...');
  handleDateRefresh(ctx);
});

bot.action('back_to_dates', (ctx) => {
  ctx.editMessageText('🔄 Загружаю доступные даты...');
  handleDateRefresh(ctx);
});

bot.action(/refresh_times_(.*)/, (ctx) => handleTimeRefresh(ctx, ctx.match[1]));

// Обработчики периодов времени
bot.action('time_period_morning', (ctx) => ctx.answerCbQuery('🌅 Утреннее время (8:00-12:00)'));
bot.action('time_period_afternoon', (ctx) => ctx.answerCbQuery('☀️ Дневное время (12:00-17:00)'));
bot.action('time_period_evening', (ctx) => ctx.answerCbQuery('🌆 Вечернее время (17:00-20:00)'));

bot.action('cancel_captcha', handleCaptchaCancel);

// === Обработка текстовых сообщений ===
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  const state = ctx.session.state;

  try {
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

      // ВАЖНО: НЕ создаем новый браузер, а продолжаем с существующим
      await bookAppointment(ctx, requestManualCaptcha);
      return;
    } else if (state === 'testing_captcha') {
      await handleTestCaptchaInput(ctx, text);
    } else {
      await handleUserDataInput(ctx, text, state);
    }
  } catch (error) {
    console.error('Ошибка при обработке текста:', error);
    await ctx.reply('Произошла ошибка. Попробуйте ещё раз.');
  }
});

// Обработчик завершения работы бота
// Обработчик завершения работы бота
process.on('SIGINT', () => {
  console.log('\n🛑 Завершение работы бота...');

  // Останавливаем периодическую проверку
  periodicCheckService.stop(); // ИСПРАВЛЕНИЕ: используем метод объекта

  // Закрываем все браузеры
  const { cleanupBrowsers } = require('./services/donor-form');
  cleanupBrowsers();

  // Останавливаем бота
  bot.stop('SIGINT');

  setTimeout(() => {
    console.log('👋 Бот остановлен');
    process.exit(0);
  }, 3000);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Завершение работы бота...');
  periodicCheckService.stop(); // ИСПРАВЛЕНИЕ: используем метод объекта

  const { cleanupBrowsers } = require('./services/donor-form');
  cleanupBrowsers();

  bot.stop('SIGTERM');

  setTimeout(() => {
    process.exit(0);
  }, 3000);
});

// === Обработка ошибок ===
bot.catch((err, ctx) => {
  console.error('Ошибка в боте:', err);
  if (ctx) {
    ctx.reply('Произошла ошибка. Попробуйте позже.').catch(console.error);
  }
});

// === Экспорт и запуск ===
module.exports = { bot, periodicCheckService };

bot.launch();
debug('Telegram бот запущен.');
