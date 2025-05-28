const { checkAvailabilityInternal, checkAvailabilityFromDateInternal } = require('../utils/dates');
const { Markup } = require('telegraf');
async function checkAvailabilityFromDate(ctx, startDate) {
  try {
    console.log('Проверяем доступность дат начиная с:', startDate.toLocaleDateString());

    const { checkAvailabilityFromDateInternal } = require('../utils/dates');
    const availableDates = await checkAvailabilityFromDateInternal(startDate);

    if (availableDates && availableDates.length > 0) {
      console.log('Найдены доступные даты:', availableDates);

      // Создаем кнопки для выбора дат
      const dateButtons = availableDates.map(dateData => [
        {
          text: dateData.displayText,
          callback_data: `select_date_${dateData.dateString}`
        }
      ]);

      // Добавляем кнопку обновления
      dateButtons.push([
        { text: '🔄 Обновить список', callback_data: 'refresh_dates' }
      ]);

      await ctx.reply('🎉 Найдены доступные даты для записи:', {
        reply_markup: { inline_keyboard: dateButtons }
      });
    } else {
      console.log('Доступных дат не найдено');
      await ctx.reply(
        '😔 Пока нет доступных дат для записи.\n\n' +
        '🔍 Я продолжу проверять и уведомлю вас, когда появятся свободные места.',
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔄 Проверить снова', callback_data: 'refresh_dates' }
            ]]
          }
        }
      );
    }
  } catch (error) {
    console.error('Ошибка при проверке доступности с определенной даты:', error);

    if (error.message.includes('net::ERR_EMPTY_RESPONSE') ||
      error.message.includes('ERR_CONNECTION_REFUSED') ||
      error.message.includes('has been closed')) {
      await ctx.reply('🌐 Сайт временно недоступен. Попробую позже...');
    } else {
      await ctx.reply('❌ Ошибка при проверке дат. Попробую позже...');
    }
  }
}

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

      // Создаем кнопки для выбора дат с отображением месяца
      const dateButtons = availableDates.map(dateData => [
        {
          text: dateData.displayText,
          callback_data: `select_date_${dateData.dateString}`
        }
      ]);

      // Добавляем кнопку обновления
      dateButtons.push([
        { text: '🔄 Обновить список', callback_data: 'refresh_dates' }
      ]);

      await ctx.reply('🎉 Найдены доступные даты для записи:', {
        reply_markup: { inline_keyboard: dateButtons }
      });
    } else {
      console.log('Доступных дат не найдено');
      await ctx.reply(
        '😔 Пока нет доступных дат для записи. Я продолжу проверять...',
        {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔄 Обновить список', callback_data: 'refresh_dates' }
            ]]
          }
        }
      );
    }
  } catch (error) {
    console.error('Ошибка при проверке доступности:', error);

    if (error.message.includes('net::ERR_EMPTY_RESPONSE') ||
      error.message.includes('ERR_CONNECTION_REFUSED')) {
      await ctx.reply('🌐 Сайт временно недоступен. Попробую позже...');
    } else {
      await ctx.reply('❌ Ошибка при проверке дат. Попробую позже...');
    }
  }
}


async function startBooking(ctx) {
  try {
    const selectedDate = ctx.session.selectedDate;
    const date = new Date(selectedDate);
    const { getMonthName } = require('../utils/dates');
    const displayDate = `${date.getDate()} ${getMonthName(date.getMonth())}`;

    await ctx.reply(`🔍 Ищу доступное время для ${displayDate}...`);

    // Получаем доступное время для выбранной даты
    const availableTimes = await getAvailableTimesForDate(selectedDate);

    if (availableTimes.length > 0) {
      // Группируем время по периодам дня
      const timeGroups = {
        morning: availableTimes.filter(time => {
          const hour = parseInt(time.split(':')[0]);
          return hour >= 8 && hour < 12;
        }),
        afternoon: availableTimes.filter(time => {
          const hour = parseInt(time.split(':')[0]);
          return hour >= 12 && hour < 17;
        }),
        evening: availableTimes.filter(time => {
          const hour = parseInt(time.split(':')[0]);
          return hour >= 17 && hour < 20;
        })
      };

      const timeButtons = [];

      if (timeGroups.morning.length > 0) {
        timeButtons.push([{ text: '🌅 Утро (8:00-12:00)', callback_data: 'time_period_morning' }]);
        timeGroups.morning.forEach(time => {
          timeButtons.push([{ text: `⏰ ${time}`, callback_data: `select_time_${time}` }]);
        });
      }

      if (timeGroups.afternoon.length > 0) {
        timeButtons.push([{ text: '☀️ День (12:00-17:00)', callback_data: 'time_period_afternoon' }]);
        timeGroups.afternoon.forEach(time => {
          timeButtons.push([{ text: `⏰ ${time}`, callback_data: `select_time_${time}` }]);
        });
      }

      if (timeGroups.evening.length > 0) {
        timeButtons.push([{ text: '🌆 Вечер (17:00-20:00)', callback_data: 'time_period_evening' }]);
        timeGroups.evening.forEach(time => {
          timeButtons.push([{ text: `⏰ ${time}`, callback_data: `select_time_${time}` }]);
        });
      }

      // Добавляем кнопки навигации
      timeButtons.push([
        { text: '🔄 Обновить время', callback_data: `refresh_times_${selectedDate}` },
        { text: '🔙 К выбору дат', callback_data: 'back_to_dates' }
      ]);

      await ctx.reply(`📅 Доступное время на ${displayDate}:`, {
        reply_markup: { inline_keyboard: timeButtons }
      });
    } else {
      await ctx.reply(
        `😔 К сожалению, на ${displayDate} нет свободного времени.`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔄 Обновить время', callback_data: `refresh_times_${selectedDate}` },
                { text: '🔙 К выбору дат', callback_data: 'back_to_dates' }
              ]
            ]
          }
        }
      );
    }
  } catch (error) {
    console.error('Ошибка в startBooking:', error);
    await ctx.reply('Произошла ошибка при поиске времени. Попробуйте позже.');
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

module.exports = { checkAvailability, checkAvailabilityFromDate, startBooking };
