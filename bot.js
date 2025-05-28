const { Telegraf } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const debug = require('debug')('bot');

// Модули
const { BOT_TOKEN } = require('./config');
const { handleStartCommand, handleStartCheckCommand, handleStopCheckCommand, handleStatusCommand } = require('./handlers/commands');
const { handleDonationType, handleUserDataInput } = require('./handlers/userRegistration');
const { handleCaptchaInput, handleTestCaptchaCommand, handleTestCaptchaInput } = require('./handlers/captcha');
const { handleDateSelection, handleTimeSelection, handleBookingConfirmation, handleDateRefresh, handleTimeRefresh, handleCaptchaCancel } = require('./handlers/navigation');
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
      // Обработка ввода капчи для реальной записи
      await handleCaptchaInput(ctx, text);
    } else if (state === 'testing_captcha') {
      // Обработка ввода капчи для теста
      await handleTestCaptchaInput(ctx, text);
    } else {
      // Обработка регистрационных данных
      await handleUserDataInput(ctx, text, state);
    }
  } catch (error) {
    console.error('Ошибка при обработке текста:', error);
    await ctx.reply('Произошла ошибка. Попробуйте ещё раз.');
  }
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
