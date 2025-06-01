const { canDonatePlasma } = require('../utils/dates');
const { checkAvailability } = require('./booking');
const { startUserRegistration, handleWaitingPeriod } = require('./userRegistration');

async function handleStartCommand(ctx, startPeriodicCheck) {
  try {
    console.log('Команда /start вызвана');

    // Инициализируем сессию
    if (!ctx.session) {
      ctx.session = {};
    }

    // Проверяем наличие данных пользователя
    if (!ctx.session.lastDonationDate || !ctx.session.donationType) {
      await startUserRegistration(ctx);
      return;
    }

    // Проверяем возможность сдачи
    const canDonate = canDonatePlasma(ctx.session.lastDonationDate, ctx.session.donationType);

    if (!canDonate) {
      // Включаем фоновую проверку
      if (ctx.session.checkingEnabled !== false) {
        ctx.session.checkingEnabled = true;
        startPeriodicCheck();
      }
      await handleWaitingPeriod(ctx);
      return;
    }

    // Включаем фоновую проверку и выполняем проверку
    if (ctx.session.checkingEnabled !== false) {
      ctx.session.checkingEnabled = true;
      startPeriodicCheck();
    }

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
}

function handleStartCheckCommand(ctx, startPeriodicCheck) {
  if (!ctx.session.checkingEnabled) {
    ctx.session.checkingEnabled = true;
    startPeriodicCheck();
    ctx.reply('Фоновая проверка снова активна.');
  } else {
    ctx.reply('Фоновая проверка уже работает.');
  }
}

// ИСПРАВЛЕНИЕ: добавляем параметр stopPeriodicCheck
function handleStopCheckCommand(ctx, stopPeriodicCheck) {
  if (stopPeriodicCheck) {
    stopPeriodicCheck();
  }
  ctx.session.checkingEnabled = false;
  ctx.reply('Фоновая проверка остановлена.');
}

function handleStatusCommand(ctx) {
  const status = ctx.session.checkingEnabled !== false ? 'активна' : 'остановлена';
  ctx.reply(`Фоновая проверка: ${status}.`);
}

module.exports = {
  handleStartCommand,
  handleStartCheckCommand,
  handleStopCheckCommand,
  handleStatusCommand
};
