const { canDonatePlasma } = require('../utils/dates');
const { checkAvailability, checkAvailabilityFromDate } = require('../handlers/booking');
const SessionManager = require('../utils/sessionManager');

class PeriodicCheckService {
  constructor(bot) {
    this.bot = bot;
    this.intervalId = null;
    this.sessionManager = new SessionManager();
  }

  start() {
    if (this.intervalId) return;

    this.intervalId = setInterval(async () => {
      await this.checkAllUsers();
    }, 60 * 60 * 1000); // Раз в час
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async checkAllUsers() {
    try {
      const allUsers = this.sessionManager.getAllUsers();

      for (const [chatId, userData] of Object.entries(allUsers)) {
        if (userData.checkingEnabled === false) {
          continue; // Пропускаем пользователей с отключенной проверкой
        }

        if (!userData.lastDonationDate || !userData.donationType) {
          continue; // Пропускаем незарегистрированных пользователей
        }

        const context = this.createMockContext(chatId, userData);
        await this.checkUserAvailability(context);
      }
    } catch (error) {
      console.error('Ошибка при проверке всех пользователей:', error);
    }
  }

  async checkUserAvailability(context) {
    try {
      const canDonate = canDonatePlasma(context.session.lastDonationDate, context.session.donationType);

      if (canDonate) {
        await checkAvailability(context);
      } else {
        const lastDate = new Date(context.session.lastDonationDate);
        const waitDays = context.session.donationType === 'blood' ? 30 : 14;
        const nextPossibleDate = new Date(lastDate.getTime() + waitDays * 24 * 60 * 60 * 1000);
        await checkAvailabilityFromDate(context, nextPossibleDate);
      }
    } catch (error) {
      console.error(`Ошибка при проверке пользователя ${context.chat.id}:`, error);
    }
  }

  createMockContext(chatId, userData) {
    return {
      chat: { id: chatId },
      session: userData,
      reply: async (text, options) => {
        try {
          await this.bot.telegram.sendMessage(chatId, text, options);
        } catch (error) {
          console.error('Ошибка отправки сообщения:', error);
        }
      },
      editMessageText: async (text, options) => {
        try {
          await this.bot.telegram.sendMessage(chatId, text, options);
        } catch (error) {
          console.error('Ошибка отправки сообщения:', error);
        }
      }
    };
  }
}

module.exports = PeriodicCheckService;
