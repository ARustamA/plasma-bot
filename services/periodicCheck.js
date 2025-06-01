const { checkAvailabilityInternal, canDonatePlasma } = require('../utils/dates');

class PeriodicCheckService {
  constructor(bot) {
    this.bot = bot;
    this.isRunning = false;
    this.intervalId = null;
    this.checkInterval = 5 * 60 * 1000; // 5 минут
    this.lastCheckTime = null;
    this.lastFoundDates = [];
  }

  start() {
    if (this.isRunning) {
      console.log('Периодическая проверка уже запущена');
      return;
    }

    console.log('🔄 Запускаем периодическую проверку дат...');
    this.isRunning = true;

    // Запускаем первую проверку сразу
    this.performCheck();

    // Устанавливаем интервал для последующих проверок
    this.intervalId = setInterval(() => {
      this.performCheck();
    }, this.checkInterval);

    console.log(`✅ Периодическая проверка запущена (интервал: ${this.checkInterval / 1000 / 60} минут)`);
  }

  stop() {
    if (!this.isRunning) {
      console.log('Периодическая проверка уже остановлена');
      return;
    }

    console.log('🛑 Останавливаем периодическую проверку...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('✅ Периодическая проверка остановлена');
  }

  async performCheck() {
    try {
      console.log('🔍 Выполняем периодическую проверку дат...');
      this.lastCheckTime = new Date();

      const availableDates = await checkAvailabilityInternal();

      if (availableDates && availableDates.length > 0) {
        console.log(`✅ Найдено ${availableDates.length} доступных дат:`, availableDates.map(d => d.displayText));

        // Проверяем, есть ли новые даты
        const newDates = this.findNewDates(availableDates);

        if (newDates.length > 0) {
          console.log(`🆕 Найдено ${newDates.length} новых дат для уведомления`);
          await this.notifyUsers(newDates);
        } else {
          console.log('ℹ️ Новых дат не найдено');
        }

        this.lastFoundDates = availableDates;
      } else {
        console.log('❌ Доступных дат не найдено');
        this.lastFoundDates = [];
      }

    } catch (error) {
      console.error('❌ Ошибка при периодической проверке:', error.message);
    }
  }

  findNewDates(currentDates) {
    if (this.lastFoundDates.length === 0) {
      // Если это первая проверка, не отправляем уведомления
      return [];
    }

    const lastDateStrings = this.lastFoundDates.map(d => d.dateString);
    const newDates = currentDates.filter(date => !lastDateStrings.includes(date.dateString));

    return newDates;
  }

  async notifyUsers(newDates) {
    try {
      // Загружаем сессии пользователей
      const LocalSession = require('telegraf-session-local');
      const sessionManager = new LocalSession({ database: 'sessions.json' });

      // Получаем все сессии
      const sessions = sessionManager.DB.get('sessions').value() || {};

      let notifiedCount = 0;

      for (const [sessionKey, session] of Object.entries(sessions)) {
        try {
          // Извлекаем userId из ключа сессии
          const userId = sessionKey.split(':')[0];

          if (!session || !session.donorData || !session.lastDonationDate) {
            continue;
          }

          // Проверяем, может ли пользователь сдавать плазму
          const canDonate = canDonatePlasma(session.lastDonationDate, session.donationType);

          if (!canDonate) {
            continue;
          }

          // Отправляем уведомление
          await this.sendNotification(userId, newDates);
          notifiedCount++;

          // Небольшая задержка между отправками
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (userError) {
          console.error(`Ошибка при уведомлении пользователя ${sessionKey}:`, userError.message);
        }
      }

      console.log(`📢 Уведомления отправлены ${notifiedCount} пользователям`);

    } catch (error) {
      console.error('❌ Ошибка при отправке уведомлений:', error);
    }
  }

  async sendNotification(userId, newDates) {
    try {
      const datesList = newDates.map(date => `📅 ${date.displayText}`).join('\n');

      const message = `🎉 *Появились новые даты для записи!*\n\n${datesList}\n\n🏃‍♂️ Поторопитесь - места быстро разбирают!`;

      await this.bot.telegram.sendMessage(userId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📅 Посмотреть даты', callback_data: 'refresh_dates' }],
            [{ text: '⏸ Остановить уведомления', callback_data: 'stop_notifications' }]
          ]
        }
      });

    } catch (error) {
      if (error.code === 403) {
        console.log(`Пользователь ${userId} заблокировал бота`);
      } else {
        console.error(`Ошибка отправки уведомления пользователю ${userId}:`, error.message);
      }
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      lastCheckTime: this.lastCheckTime,
      checkInterval: this.checkInterval,
      lastFoundDatesCount: this.lastFoundDates.length,
      lastFoundDates: this.lastFoundDates.map(d => d.displayText)
    };
  }

  setCheckInterval(minutes) {
    if (minutes < 1) {
      throw new Error('Интервал не может быть меньше 1 минуты');
    }

    this.checkInterval = minutes * 60 * 1000;

    if (this.isRunning) {
      // Перезапускаем с новым интервалом
      this.stop();
      this.start();
    }

    console.log(`✅ Интервал проверки изменен на ${minutes} минут`);
  }
}

module.exports = PeriodicCheckService;
