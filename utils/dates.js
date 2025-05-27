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

    // Определяем временные рамки для проверки
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Конец следующего месяца
    const endDate = new Date(today.getFullYear(), today.getMonth() + 2, 0);

    console.log(`Проверяем даты с ${tomorrow.toLocaleDateString()} по ${endDate.toLocaleDateString()}`);

    // Ждем загрузки календаря
    await page.waitForSelector('.donorform-calendars', { timeout: 10000 });

    const availableDates = [];

    // Проверяем текущий месяц и следующий
    const monthsToCheck = [
      { month: today.getMonth(), year: today.getFullYear() },
      { month: today.getMonth() + 1, year: today.getFullYear() }
    ];

    // Корректируем год если переходим в следующий год
    if (monthsToCheck[1].month > 11) {
      monthsToCheck[1].month = 0;
      monthsToCheck[1].year += 1;
    }

    for (let i = 0; i < monthsToCheck.length; i++) {
      const monthData = monthsToCheck[i];
      console.log(`Проверяем месяц: ${monthData.month + 1}/${monthData.year}`);

      // Переключаемся на нужный месяц в календаре
      await navigateToMonth(page, monthData.month, monthData.year);

      // Ждем обновления календаря
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
    const currentMonthElement = await page.locator('.slick-active .donorform-calendar__month').first();
    const currentYearElement = await page.locator('.slick-active .donorform-calendar__year').first();

    const currentMonthText = await currentMonthElement.textContent();
    const currentYear = parseInt(await currentYearElement.textContent());

    // Преобразуем название месяца в номер
    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const currentMonth = monthNames.indexOf(currentMonthText);

    console.log(`Текущий месяц в календаре: ${currentMonth + 1}/${currentYear}`);
    console.log(`Целевой месяц: ${targetMonth + 1}/${targetYear}`);

    // Если уже на нужном месяце, ничего не делаем
    if (currentMonth === targetMonth && currentYear === targetYear) {
      console.log('Уже на нужном месяце');
      return;
    }

    // Определяем направление навигации
    const currentDate = new Date(currentYear, currentMonth, 1);
    const targetDate = new Date(targetYear, targetMonth, 1);

    if (targetDate > currentDate) {
      // Нужно идти вперед
      console.log('Переключаемся на следующий месяц');
      const nextButton = await page.locator('.slick-next').first();
      await nextButton.click();
    } else if (targetDate < currentDate) {
      // Нужно идти назад
      console.log('Переключаемся на предыдущий месяц');
      const prevButton = await page.locator('.slick-prev').first();
      await prevButton.click();
    }

    // Ждем обновления календаря
    await page.waitForTimeout(1000);

    // Проверяем, что переключились на нужный месяц
    const newMonthText = await page.locator('.slick-active .donorform-calendar__month').first().textContent();
    const newYear = parseInt(await page.locator('.slick-active .donorform-calendar__year').first().textContent());
    const newMonth = monthNames.indexOf(newMonthText);

    console.log(`После навигации: ${newMonth + 1}/${newYear}`);

    // Если не попали на нужный месяц, попробуем еще раз
    if (newMonth !== targetMonth || newYear !== targetYear) {
      console.log('Не попали на нужный месяц, попробуем еще раз...');
      await navigateToMonth(page, targetMonth, targetYear);
    }

  } catch (error) {
    console.error('Ошибка при навигации по календарю:', error);
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
      const mon