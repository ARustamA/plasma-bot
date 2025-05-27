const { checkAvailabilityInternal } = require('../utils/dates');
const { Markup } = require('telegraf');

async function closeModalIfExists(page) {
  try {
    await page.waitForSelector('.donorform-modal', { timeout: 5000 });

    console.log('Найдено модальное окно, закрываем...');

    const closeSelectors = [
      '.js-donorform-modal-close',
      '.close',
      '.donorform-modal-firsttime'
    ];

    for (const selector of closeSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.isVisible()) {
          await element.click();
          console.log(`Модальное окно закрыто через: ${selector}`);
          await page.waitForSelector('.donorform-modal', { state: 'hidden', timeout: 3000 });
          return true;
        }
      } catch (e) {
        // Продолжаем пробовать другие селекторы
      }
    }

    await page.keyboard.press('Escape');
    console.log('Попытка закрыть модальное окно через ESC');

    return true;
  } catch (error) {
    console.log('Модальное окно не найдено или уже закрыто');
    return false;
  }
}

async function checkAvailability(ctx) {
  try {
    console.log('Проверяем доступность дат...');

    const availableDates = await checkAvailabilityInternal();

    if (availableDates && availableDates.length > 0) {
      console.log('Найдены доступные даты:', availableDates);

      // Создаем кнопки для выбора дат с красивым отображением
      const dateButtons = availableDates.map(dateData => [
        Markup.button.callback(
          `📅 ${dateData.displayText}`,
          `select_date_${dateData.dateString}`
        )
      ]);

      // Добавляем кнопку обновления
      dateButtons.push([
        Markup.button.callback('🔄 Обновить список', 'refresh_dates')
      ]);

      await ctx.reply(
        '🎉 *Найдены доступные даты для записи на плазму:*\n\n' +
        '📋 Выберите подходящую дату из списка ниже:',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: dateButtons }
        }
      );
    } else {
      console.log('Доступных дат не найдено');

      const refreshButton = Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Проверить снова', 'refresh_dates')]
      ]);

      await ctx.reply(
        '😔 *Пока нет доступных дат для записи*\n\n' +
        '🔍 Я продолжу автоматически проверять каждый час.\n' +
        '💡 Вы также можете проверить вручную:',
        {
          parse_mode: 'Markdown',
          ...refreshButton
        }
      );
    }
  } catch (error) {
    console.error('Ошибка при проверке доступности:', error);

    const refreshButton = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Попробовать снова', 'refresh_dates')]
    ]);

    if (error.message.includes('net::ERR_EMPTY_RESPONSE') ||
      error.message.includes('ERR_CONNECTION_REFUSED')) {
      await ctx.reply(
        '🌐 *Сайт временно недоступен*\n\n' +
        '⏰ Попробую автоматически через час.\n' +
        '🔄 Или попробуйте обновить вручную:',
        {
          parse_mode: 'Markdown',
          ...refreshButton
        }
      );
    } else {
      await ctx.reply(
        '❌ *Ошибка при проверке дат*\n\n' +
        '🔧 Возможно, временные технические проблемы.\n' +
        '⏰ Попробую снова через час:',
        {
          parse_mode: 'Markdown',
          ...refreshButton
        }
      );
    }
  }
}

async function startBooking(ctx) {
  try {
    const selectedDate = ctx.session.selectedDate;
    const date = new Date(selectedDate);
    const { getMonthName } = require('../utils/dates');
    const displayDate = `${date.getDate()} ${getMonthName(date.getMonth())}`;

    await ctx.reply(`🔍 *Поиск свободного времени*\n\n📅 Дата: ${displayDate}\n⏳ Загружаю доступные слоты...`, {
      parse_mode: 'Markdown'
    });

    // Получаем доступное время для выбранной даты
    const availableTimes = await getAvailableTimesForDate(selectedDate);

    if (availableTimes.length > 0) {
      // Группируем время по периодам дня для удобства
      const morningTimes = availableTimes.filter(time => {
        const hour = parseInt(time.split(':')[0]);
        return hour >= 8 && hour < 12;
      });

      const afternoonTimes = availableTimes.filter(time => {
        const hour = parseInt(time.split(':')[0]);
        return hour >= 12 && hour < 17;
      });

      const eveningTimes = availableTimes.filter(time => {
        const hour = parseInt(time.split(':')[0]);
        return hour >= 17;
      });

      const timeButtons = [];

      // Добавляем утренние слоты
      if (morningTimes.length > 0) {
        morningTimes.forEach(time => {
          timeButtons.push([
            Markup.button.callback(`🌅 ${time}`, `select_time_${time}`)
          ]);
        });
      }

      // Добавляем дневные слоты
      if (afternoonTimes.length > 0) {
        afternoonTimes.forEach(time => {
          timeButtons.push([
            Markup.button.callback(`☀️ ${time}`, `select_time_${time}`)
          ]);
        });
      }

      // Добавляем вечерние слоты
      if (eveningTimes.length > 0) {
        eveningTimes.forEach(time => {
          timeButtons.push([
            Markup.button.callback(`🌆 ${time}`, `select_time_${time}`)
          ]);
        });
      }

      // Добавляем кнопки навигации
      timeButtons.push([
        Markup.button.callback('🔙 Выбрать другую дату', 'back_to_dates'),
        Markup.button.callback('🔄 Обновить время', `refresh_times_${selectedDate}`)
      ]);

      await ctx.reply(
        `⏰ *Доступное время на ${displayDate}:*\n\n` +
        `🌅 Утро: ${morningTimes.length} слотов\n` +
        `☀️ День: ${afternoonTimes.length} слотов\n` +
        `🌆 Вечер: ${eveningTimes.length} слотов\n\n` +
        '👆 Выберите удобное время:',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: timeButtons }
        }
      );
    } else {
      const backButton = Markup.inlineKeyboard([
        [Markup.button.callback('🔙 Выбрать другую дату', 'back_to_dates')],
        [Markup.button.callback('🔄 Обновить время', `refresh_times_${selectedDate}`)]
      ]);

      await ctx.reply(
        `😔 *На ${displayDate} нет свободного времени*\n\n` +
        '💡 Попробуйте выбрать другую дату или обновить список:',
        {
          parse_mode: 'Markdown',
          ...backButton
        }
      );
    }
  } catch (error) {
    console.error('Ошибка в startBooking:', error);

    const errorButtons = Markup.inlineKeyboard([
      [Markup.button.callback('🔙 К выбору дат', 'back_to_dates')],
      [Markup.button.callback('🔄 Попробовать снова', `refresh_times_${ctx.session.selectedDate}`)]
    ]);

    await ctx.reply(
      '❌ *Ошибка при загрузке времени*\n\n' +
      '🔧 Возможно, временные технические проблемы.\n' +
      '💡 Попробуйте позже или выберите другую дату:',
      {
        parse_mode: 'Markdown',
        ...errorButtons
      }
    );
  }
}

async function getAvailableTimesForDate(dateString) {
  const { chromium } = require('playwright');
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Переходим на страницу
    await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');

    // Закрываем модальное окно
    await closeModalIfExists(page);
    await page.waitForTimeout(1000);

    // Получаем HTML с доступным временем
    const response = await page.evaluate(async (date) => {
      const url = `https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/?donorform_intervals&reference=109270&date=${date}&time=`;

      try {
        const response = await fetch(url);
        return await response.text();
      } catch (error) {
        return '';
      }
    }, dateString);

    // Парсим HTML и извлекаем доступное время
    const times = [];
    const timeRegex = /(\d{2}:\d{2})\s*<span[^>]*>\((\d+)\)<\/span>/g;
    let match;

    while ((match = timeRegex.exec(response)) !== null) {
      const time = match[1];
      const availableSlots = parseInt(match[2]);

      if (availableSlots > 0) {
        times.push(time);
      }
    }

    // Сортируем время по возрастанию
    times.sort((a, b) => {
      const timeA = a.split(':').map(Number);
      const timeB = b.split(':').map(Number);
      return timeA[0] * 60 + timeA[1] - (timeB[0] * 60 + timeB[1]);
    });

    return times;

  } catch (error) {
    console.error('Ошибка при получении времени:', error);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { checkAvailability, startBooking };
