const { chromium } = require('playwright');

// Функция для получения названия месяца
function getMonthName(monthIndex) {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  return months[monthIndex];
}

async function checkAvailabilityInternal() {
  let browser;
  try {
    console.log('Запускаем браузер для проверки дат...');

    browser = await chromium.launch({
      headless: true,
      timeout: 30000
    });

    const page = await browser.newPage();
    const url = 'https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/';

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Закрываем модальное окно
    try {
      await page.waitForSelector('.donorform-modal', { timeout: 3000 });
      await page.click('.js-donorform-modal-close');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('Модальное окно не найдено');
    }

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Конец следующего месяца
    const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0);

    await page.waitForSelector('.donorform-calendars', { timeout: 10000 });

    const availableDates = [];

    // Проверяем только текущий и следующий месяц (календарь показывает только их)
    const monthsToCheck = [
      { month: today.getMonth(), year: today.getFullYear() },
      { month: (today.getMonth() + 1) % 12, year: today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear() }
    ];

    for (let i = 0; i < monthsToCheck.length; i++) {
      const monthData = monthsToCheck[i];
      console.log(`Проверяем месяц: ${monthData.month + 1}/${monthData.year}`);

      // Переключаемся на нужный месяц только если это не первый месяц
      if (i > 0) {
        const navigationSuccess = await navigateToMonth(page, monthData.month, monthData.year);
        if (!navigationSuccess) {
          console.log(`Пропускаем месяц ${monthData.month + 1}/${monthData.year} - недоступен`);
          continue;
        }
      }

      await page.waitForTimeout(1000);

      // Получаем доступные даты из текущего календаря
      const monthDates = await getAvailableDatesFromCurrentCalendar(page, tomorrow, endDate);

      // Проверяем доступность времени для каждой даты
      for (const dateData of monthDates) {
        console.log(`Проверяем доступность времени для ${dateData.displayText}...`);

        const hasAvailableTime = await checkTimeAvailability(page, dateData.dateString);

        if (hasAvailableTime) {
          availableDates.push(dateData);
          console.log(`✅ ${dateData.displayText} - есть свободное время`);
        } else {
          console.log(`❌ ${dateData.displayText} - нет свободного времени`);
        }
      }
    }

    return availableDates;

  } catch (error) {
    console.error('Ошибка при проверке дат:', error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}


async function navigateToMonth(page, targetMonth, targetYear) {
  try {
    console.log(`Навигация к месяцу: ${targetMonth + 1}/${targetYear}`);

    // Получаем текущий отображаемый месяц
    const currentMonthData = await page.evaluate(() => {
      const monthElement = document.querySelector('.slick-active .donorform-calendar__month');
      const yearElement = document.querySelector('.slick-active .donorform-calendar__year');

      if (!monthElement || !yearElement) {
        return null;
      }

      const monthText = monthElement.textContent.trim();
      const year = parseInt(yearElement.textContent.trim());

      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
      const month = monthNames.indexOf(monthText);

      return { month, year };
    });

    if (!currentMonthData) {
      console.log('Не удалось получить данные текущего месяца');
      return false;
    }

    console.log(`Текущий месяц: ${currentMonthData.month}/${currentMonthData.year}`);
    console.log(`Целевой месяц: ${targetMonth}/${targetYear}`);

    // Если уже на нужном месяце
    if (currentMonthData.month === targetMonth && currentMonthData.year === targetYear) {
      console.log('Уже на нужном месяце');
      return true;
    }

    // Определяем, нужно ли переключиться на следующий месяц
    const currentDate = new Date(currentMonthData.year, currentMonthData.month);
    const targetDate = new Date(targetYear, targetMonth);

    // Переключаемся только на следующий месяц (календарь показывает только 2 месяца)
    if (targetDate > currentDate) {
      console.log('Переключаемся на следующий месяц');

      const nextButton = await page.locator('.slick-next:not(.slick-disabled)').first();
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(1500);

        // Проверяем результат
        const newMonthData = await page.evaluate(() => {
          const monthElement = document.querySelector('.slick-active .donorform-calendar__month');
          const yearElement = document.querySelector('.slick-active .donorform-calendar__year');

          if (!monthElement || !yearElement) return null;

          const monthText = monthElement.textContent.trim();
          const year = parseInt(yearElement.textContent.trim());
          const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
            'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
          const month = monthNames.indexOf(monthText);

          return { month, year };
        });

        if (newMonthData && newMonthData.month === targetMonth && newMonthData.year === targetYear) {
          console.log('Успешно переключились на нужный месяц');
          return true;
        }
      }
    }

    console.log(`Не удалось переключиться на месяц ${targetMonth + 1}/${targetYear}`);
    return false;

  } catch (error) {
    console.error('Ошибка при навигации по календарю:', error);
    return false;
  }
}



async function getAvailableDatesFromCurrentCalendar(page, tomorrow, endDate) {
  try {
    console.log('Получаем доступные даты из текущего календаря...');

    const availableDatesData = await page.evaluate((tomorrowTime, endDateTime) => {
      const tomorrow = new Date(tomorrowTime);
      const endDate = new Date(endDateTime);

      // Получаем текущий отображаемый месяц и год
      const monthElement = document.querySelector('.slick-active .donorform-calendar__month');
      const yearElement = document.querySelector('.slick-active .donorform-calendar__year');

      if (!monthElement || !yearElement) {
        console.log('Не найдены элементы месяца/года');
        return [];
      }

      const monthText = monthElement.textContent.trim();
      const year = parseInt(yearElement.textContent.trim());

      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
      const month = monthNames.indexOf(monthText);

      if (month === -1) {
        console.log('Не удалось определить месяц:', monthText);
        return [];
      }

      console.log(`Обрабатываем календарь: ${monthText} ${year} (месяц ${month})`);

      // Ищем все активные даты в текущем календаре
      const dateElements = document.querySelectorAll('.slick-active .donorform-calendar__body td:not(.past):not(.empty):not(.busy)');
      const dates = [];
      const seenDates = new Set();

      dateElements.forEach(el => {
        const dayText = el.textContent.trim();
        const dayNumber = parseInt(dayText);

        if (dayNumber && dayNumber >= 1 && dayNumber <= 31) {
          const date = new Date(year, month, dayNumber);

          // Проверяем, что дата в нужном диапазоне
          if (date >= tomorrow && date <= endDate) {
            const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;

            if (!seenDates.has(dateString)) {
              seenDates.add(dateString);

              const monthNamesRu = [
                'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
              ];

              dates.push({
                day: dayNumber,
                month: month,
                year: year,
                dateString: dateString,
                displayText: `${dayNumber} ${monthNamesRu[month]}`
              });

              console.log(`Найдена доступная дата: ${dateString}`);
            }
          }
        }
      });

      // Сортируем даты по возрастанию
      dates.sort((a, b) => new Date(a.dateString) - new Date(b.dateString));

      return dates;
    }, tomorrow.getTime(), endDate.getTime());

    console.log('Найденные даты в текущем календаре:', availableDatesData);
    return availableDatesData;

  } catch (error) {
    console.error('Ошибка при получении дат из календаря:', error);
    return [];
  }
}
// Добавляем новую функцию checkAvailabilityFromDateInternal
async function checkAvailabilityFromDateInternal(startDate) {
  let browser;
  try {
    console.log('Запускаем браузер для проверки дат начиная с:', startDate.toLocaleDateString());

    browser = await chromium.launch({
      headless: true,
      timeout: 30000
    });

    const page = await browser.newPage();

    const url = 'https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/';
    console.log('Переходим на:', url);

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Закрываем модальное окно если есть
    try {
      await page.waitForSelector('.donorform-modal', { timeout: 3000 });
      await page.click('.js-donorform-modal-close');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('Модальное окно не найдено');
    }

    // Определяем конечную дату (конец следующего месяца от startDate)
    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 2, 0);

    console.log(`Проверяем даты с ${startDate.toLocaleDateString()} по ${endDate.toLocaleDateString()}`);

    // Получаем уникальные месяцы для проверки
    const monthsToCheck = [];
    const currentMonth = startDate.getMonth();
    const currentYear = startDate.getFullYear();

    // Добавляем текущий месяц
    monthsToCheck.push({ month: currentMonth, year: currentYear });

    // Добавляем следующий месяц если нужно
    const nextMonth = currentMonth + 1;
    const nextYear = nextMonth > 11 ? currentYear + 1 : currentYear;
    const adjustedNextMonth = nextMonth > 11 ? 0 : nextMonth;

    if (endDate.getMonth() !== currentMonth || endDate.getFullYear() !== currentYear) {
      monthsToCheck.push({ month: adjustedNextMonth, year: nextYear });
    }

    const allAvailableDates = [];

    // Проверяем каждый месяц
    for (const monthData of monthsToCheck) {
      console.log(`Проверяем месяц: ${monthData.month}/${monthData.year}`);

      try {
        // Навигируем к нужному месяцу
        const navigationSuccess = await navigateToMonth(page, monthData.month, monthData.year);

        if (!navigationSuccess) {
          console.log(`Не удалось переключиться на месяц ${monthData.month + 1}/${monthData.year}`);
          continue;
        }

        // Получаем доступные даты из текущего календаря
        const monthDates = await getAvailableDatesFromCurrentCalendarFromDate(page, startDate, endDate);

        // Проверяем доступность времени для каждой даты
        for (const dateData of monthDates) {
          console.log(`  → Проверяем доступность времени для ${dateData.displayText}...`);

          const hasAvailableTime = await checkTimeAvailability(page, dateData.dateString);

          if (hasAvailableTime) {
            allAvailableDates.push(dateData);
            console.log(`  ✅ ${dateData.displayText} - есть свободное время`);
          } else {
            console.log(`  ❌ ${dateData.displayText} - нет свободного времени`);
          }
        }

      } catch (error) {
        console.error(`Ошибка при проверке месяца ${monthData.month + 1}/${monthData.year}:`, error);
        continue;
      }
    }

    // Сортируем все найденные даты
    allAvailableDates.sort((a, b) => new Date(a.dateString) - new Date(b.dateString));

    return allAvailableDates;

  } catch (error) {
    console.error('Ошибка при проверке дат с определенной даты:', error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}



async function getAvailableDatesFromCurrentCalendarFromDate(page, startDate, endDate) {
  try {
    console.log('Получаем доступные даты из текущего календаря начиная с:', startDate.toLocaleDateString());

    // ИСПРАВЛЕНИЕ: передаем объект вместо двух отдельных аргументов
    const availableDatesData = await page.evaluate((dateRange) => {
      const startDate = new Date(dateRange.startDateTime);
      const endDate = new Date(dateRange.endDateTime);

      // Получаем текущий отображаемый месяц и год
      const monthElement = document.querySelector('.slick-active .donorform-calendar__month');
      const yearElement = document.querySelector('.slick-active .donorform-calendar__year');

      if (!monthElement || !yearElement) {
        console.log('Не найдены элементы месяца/года');
        return [];
      }

      const monthText = monthElement.textContent.trim();
      const year = parseInt(yearElement.textContent.trim());

      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
      const month = monthNames.indexOf(monthText);

      if (month === -1) {
        console.log('Не удалось определить месяц:', monthText);
        return [];
      }

      console.log(`Обрабатываем календарь: ${monthText} ${year} (месяц ${month})`);

      // Ищем все активные даты в текущем календаре
      const dateElements = document.querySelectorAll('.slick-active .donorform-calendar__body td:not(.past):not(.empty)');
      const dates = [];
      const seenDates = new Set();

      dateElements.forEach(el => {
        const dayText = el.textContent.trim();
        const dayNumber = parseInt(dayText);

        if (dayNumber && dayNumber >= 1 && dayNumber <= 31) {
          const date = new Date(year, month, dayNumber);

          // Проверяем, что дата в нужном диапазоне
          if (date >= startDate && date <= endDate) {
            const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;

            if (!seenDates.has(dateString)) {
              seenDates.add(dateString);

              const monthNamesRu = [
                'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
              ];

              dates.push({
                day: dayNumber,
                month: month,
                year: year,
                dateString: dateString,
                displayText: `${dayNumber} ${monthNamesRu[month]}`
              });

              console.log(`Найдена потенциально доступная дата: ${dateString}`);
            }
          }
        }
      });

      dates.sort((a, b) => new Date(a.dateString) - new Date(b.dateString));
      return dates;
    }, {
      startDateTime: startDate.getTime(),
      endDateTime: endDate.getTime()
    });

    console.log('Найденные даты в текущем календаре:', availableDatesData);
    return availableDatesData;

  } catch (error) {
    console.error('Ошибка при получении дат из календаря:', error);
    return [];
  }
}

async function checkTimeAvailability(page, dateString) {
  try {
    console.log(`  → Запрашиваем время для ${dateString}...`);

    // Отправляем AJAX запрос для получения доступного времени
    const response = await page.evaluate(async (date) => {
      const url = `https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/?donorform_intervals&reference=109270&date=${date}&time=`;

      try {
        const response = await fetch(url);
        const text = await response.text();
        console.log(`Ответ для ${date}:`, text.substring(0, 200) + '...');
        return text;
      } catch (error) {
        console.error('Ошибка AJAX запроса:', error);
        return '';
      }
    }, dateString);

    if (!response) {
      console.log(`  → Пустой ответ для ${dateString}`);
      return false;
    }

    // Улучшенная проверка доступных слотов
    const hasAvailableSlots = (
      response.includes('intervals-column-item') ||
      response.includes('time-slot') ||
      response.includes('available')
    ) && (
        // Проверяем, что есть слоты с доступными местами
        response.includes('(1)') ||
        response.includes('(2)') ||
        response.includes('(3)') ||
        response.includes('(4)') ||
        response.includes('(5)')
      ) && (
        // И нет признаков полной занятости
        !response.includes('Нет доступных') &&
        !response.includes('записи закрыты') &&
        !response.includes('недоступно')
      );

    console.log(`  → Результат для ${dateString}: ${hasAvailableSlots ? 'ДОСТУПНО' : 'ЗАНЯТО'}`);

    return hasAvailableSlots;

  } catch (error) {
    console.error(`Ошибка при проверке времени для ${dateString}:`, error);
    return false;
  }
}

function canDonatePlasma(lastDonationDate, donationType) {
  try {
    const lastDate = new Date(lastDonationDate);
    const today = new Date();

    today.setHours(0, 0, 0, 0);
    lastDate.setHours(0, 0, 0, 0);

    const daysDiff = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));

    const requiredDays = donationType === 'blood' ? 30 : 14;

    return daysDiff >= requiredDays;
  } catch (error) {
    console.error('Ошибка при проверке возможности сдачи:', error);
    return false;
  }
}

module.exports = {
  checkAvailabilityInternal,
  checkAvailabilityFromDateInternal,
  canDonatePlasma,
  getMonthName
};
