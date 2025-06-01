const { chromium } = require('playwright');

function getMonthName(monthIndex) {
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  return months[monthIndex];
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
    await closeModalIfExists(page);

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0);

    await page.waitForSelector('.donorform-calendars', { timeout: 10000 });

    const availableDates = [];

    // Проверяем текущий и следующий месяц
    const monthsToCheck = [
      { month: today.getMonth(), year: today.getFullYear() },
      { month: (today.getMonth() + 1) % 12, year: today.getMonth() === 11 ? today.getFullYear() + 1 : today.getFullYear() }
    ];

    for (let i = 0; i < monthsToCheck.length; i++) {
      const monthData = monthsToCheck[i];
      console.log(`Проверяем месяц: ${monthData.month + 1}/${monthData.year}`);

      if (i > 0) {
        const navigationSuccess = await navigateToMonth(page, monthData.month, monthData.year);
        if (!navigationSuccess) {
          console.log(`Пропускаем месяц ${monthData.month + 1}/${monthData.year} - недоступен`);
          continue;
        }
      }

      await page.waitForTimeout(1000);

      const monthDates = await getAvailableDatesFromCurrentCalendar(page, tomorrow, endDate);

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

    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await closeModalIfExists(page);

    const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 2, 0);

    console.log(`Проверяем даты с ${startDate.toLocaleDateString()} по ${endDate.toLocaleDateString()}`);

    const monthsToCheck = [];
    const currentMonth = startDate.getMonth();
    const currentYear = startDate.getFullYear();

    monthsToCheck.push({ month: currentMonth, year: currentYear });

    const nextMonth = currentMonth + 1;
    const nextYear = nextMonth > 11 ? currentYear + 1 : currentYear;
    const adjustedNextMonth = nextMonth > 11 ? 0 : nextMonth;

    if (endDate.getMonth() !== currentMonth || endDate.getFullYear() !== currentYear) {
      monthsToCheck.push({ month: adjustedNextMonth, year: nextYear });
    }

    const allAvailableDates = [];

    for (const monthData of monthsToCheck) {
      console.log(`Проверяем месяц: ${monthData.month}/${monthData.year}`);

      try {
        const navigationSuccess = await navigateToMonth(page, monthData.month, monthData.year);

        if (!navigationSuccess) {
          console.log(`Не удалось переключиться на месяц ${monthData.month + 1}/${monthData.year}`);
          continue;
        }

        const monthDates = await getAvailableDatesFromCurrentCalendarFromDate(page, startDate, endDate);

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

async function closeModalIfExists(page) {
  try {
    await page.waitForSelector('.donorform-modal', { timeout: 3000 });
    await page.click('.js-donorform-modal-close');
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log('Модальное окно не найдено');
  }
}

async function navigateToMonth(page, targetMonth, targetYear) {
  try {
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
      return false;
    }

    if (currentMonthData.month === targetMonth && currentMonthData.year === targetYear) {
      return true;
    }

    const currentDate = new Date(currentMonthData.year, currentMonthData.month);
    const targetDate = new Date(targetYear, targetMonth);

    if (targetDate > currentDate) {
      const nextButton = await page.locator('.slick-next:not(.slick-disabled)').first();
      if (await nextButton.isVisible()) {
        await nextButton.click();
        await page.waitForTimeout(1500);

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

        return newMonthData && newMonthData.month === targetMonth && newMonthData.year === targetYear;
      }
    }

    return false;

  } catch (error) {
    console.error('Ошибка при навигации по календарю:', error);
    return false;
  }
}

async function getAvailableDatesFromCurrentCalendar(page, tomorrow, endDate) {
  try {
    const availableDatesData = await page.evaluate((dateRange) => {
      const tomorrow = new Date(dateRange.tomorrowTime);
      const endDate = new Date(dateRange.endDateTime);

      const monthElement = document.querySelector('.slick-active .donorform-calendar__month');
      const yearElement = document.querySelector('.slick-active .donorform-calendar__year');

      if (!monthElement || !yearElement) {
        return [];
      }

      const monthText = monthElement.textContent.trim();
      const year = parseInt(yearElement.textContent.trim());

      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
      const month = monthNames.indexOf(monthText);

      if (month === -1) {
        return [];
      }

      const dateElements = document.querySelectorAll('.slick-active .donorform-calendar__body td:not(.past):not(.empty):not(.busy)');
      const dates = [];
      const seenDates = new Set();

      dateElements.forEach(el => {
        const dayText = el.textContent.trim();
        const dayNumber = parseInt(dayText);

        if (dayNumber && dayNumber >= 1 && dayNumber <= 31) {
          const date = new Date(year, month, dayNumber);

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
            }
          }
        }
      });

      dates.sort((a, b) => new Date(a.dateString) - new Date(b.dateString));
      return dates;
    }, {
      tomorrowTime: tomorrow.getTime(),
      endDateTime: endDate.getTime()
    });

    return availableDatesData;

  } catch (error) {
    console.error('Ошибка при получении дат из календаря:', error);
    return [];
  }
}
async function getAvailableDatesFromCurrentCalendarFromDate(page, startDate, endDate) {
  try {
    const availableDatesData = await page.evaluate((dateRange) => {
      const startDate = new Date(dateRange.startDateTime);
      const endDate = new Date(dateRange.endDateTime);

      const monthElement = document.querySelector('.slick-active .donorform-calendar__month');
      const yearElement = document.querySelector('.slick-active .donorform-calendar__year');

      if (!monthElement || !yearElement) {
        return [];
      }

      const monthText = monthElement.textContent.trim();
      const year = parseInt(yearElement.textContent.trim());

      const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
      const month = monthNames.indexOf(monthText);

      if (month === -1) {
        return [];
      }

      const dateElements = document.querySelectorAll('.slick-active .donorform-calendar__body td:not(.past):not(.empty)');
      const dates = [];
      const seenDates = new Set();

      dateElements.forEach(el => {
        const dayText = el.textContent.trim();
        const dayNumber = parseInt(dayText);

        if (dayNumber && dayNumber >= 1 && dayNumber <= 31) {
          const date = new Date(year, month, dayNumber);

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

    return availableDatesData;

  } catch (error) {
    console.error('Ошибка при получении дат из календаря:', error);
    return [];
  }
}

async function checkTimeAvailability(page, dateString) {
  try {
    const response = await page.evaluate(async (date) => {
      const url = `https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/?donorform_intervals&reference=109270&date=${date}&time=`;

      try {
        const response = await fetch(url);
        const text = await response.text();
        return text;
      } catch (error) {
        return '';
      }
    }, dateString);

    if (!response) {
      return false;
    }

    const hasAvailableSlots = (
      response.includes('intervals-column') &&
      response.includes('data-value=') &&
      (response.includes('(1)') ||
        response.includes('(2)') ||
        response.includes('(3)') ||
        response.includes('(4)') ||
        response.includes('(5)') ||
        response.includes('(6)') ||
        response.includes('(7)') ||
        response.includes('(8)') ||
        response.includes('(9)'))
    ) && (
        !response.includes('Нет доступных') &&
        !response.includes('записи закрыты') &&
        !response.includes('недоступно')
      );

    return hasAvailableSlots;

  } catch (error) {
    console.error(`Ошибка при проверке времени для ${dateString}:`, error);
    return false;
  }
}

module.exports = {
  checkAvailabilityInternal,
  checkAvailabilityFromDateInternal,
  canDonatePlasma,
  getMonthName
};
