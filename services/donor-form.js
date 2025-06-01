const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { Markup } = require('telegraf');
const { normalizeBirthDate } = require('../handlers/userRegistration');
// Глобальное хранилище браузеров для каждого пользователя
const userBrowsers = new Map();

// Функция для безопасного закрытия браузера - ПЕРЕМЕЩАЕМ В НАЧАЛО
async function closeBrowserSafely(userId) {
  if (!userBrowsers.has(userId)) {
    return;
  }

  try {
    const browserData = userBrowsers.get(userId);
    if (browserData && browserData.browser) {
      // Проверяем, что браузер еще открыт
      if (browserData.browser.isConnected && browserData.browser.isConnected()) {
        await browserData.browser.close();
        console.log(`Браузер пользователя ${userId} успешно закрыт`);
      } else {
        console.log(`Браузер пользователя ${userId} уже был закрыт`);
      }
    }
  } catch (e) {
    console.log(`Ошибка при закрытии браузера пользователя ${userId}:`, e.message);
  } finally {
    userBrowsers.delete(userId);
  }
}

// Улучшенная функция для очистки браузеров при завершении работы
function cleanupBrowsers() {
  if (userBrowsers.size === 0) {
    console.log('Нет открытых браузеров для закрытия');
    return;
  }

  console.log(`Закрываем ${userBrowsers.size} открытых браузеров...`);

  const cleanupPromises = [];

  for (const [userId, browserData] of userBrowsers) {
    const cleanupPromise = (async () => {
      try {
        if (browserData && browserData.browser) {
          // Проверяем, что браузер еще подключен
          if (browserData.browser.isConnected && browserData.browser.isConnected()) {
            await browserData.browser.close();
            console.log(`✅ Браузер пользователя ${userId} закрыт`);
          } else {
            console.log(`ℹ️ Браузер пользователя ${userId} уже был отключен`);
          }
        }
      } catch (e) {
        console.log(`❌ Ошибка при закрытии браузера пользователя ${userId}:`, e.message);
      }
    })();

    cleanupPromises.push(cleanupPromise);
  }

  // Ждем завершения всех операций закрытия (с таймаутом)
  Promise.allSettled(cleanupPromises).then(() => {
    userBrowsers.clear();
    console.log('✅ Очистка браузеров завершена');
  }).catch((error) => {
    console.error('❌ Ошибка при очистке браузеров:', error);
    userBrowsers.clear();
  });
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

async function bookAppointment(ctx, requestManualCaptchaFn) {
  const userId = ctx.from.id;

  try {
    console.log('Начинаем процесс записи...');

    // Если это первая попытка - создаем браузер и настраиваем форму
    if (ctx.session.state !== 'captcha_received') {
      console.log('Первая попытка - создаем браузер и настраиваем форму');

      // Закрываем предыдущий браузер если есть
      await closeBrowserSafely(userId);

      const browser = await chromium.launch({ headless: false });
      const page = await browser.newPage();

      // Сохраняем и браузер, и страницу
      userBrowsers.set(userId, { browser, page });

      // Переходим на страницу записи
      await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');

      // Закрываем модальное окно если оно появилось
      await closeModalIfExists(page);
      await page.waitForTimeout(1000);

      try {
        // Пробуем сначала клики
        await selectDateInCalendar(page, ctx.session.selectedDate);
        await selectTimeSlot(page, ctx.session.selectedTime);
      } catch (clickError) {
        console.log('Клики не сработали, пробуем прямой переход:', clickError.message);

        // Если клики не работают, используем прямой переход
        await selectDateAndTimeDirectly(page, ctx.session.selectedDate, ctx.session.selectedTime);
      }

      // Заполняем форму данными пользователя
      await fillFormData(page, ctx.session.donorData);

      // Сохраняем страницу в сессии
      ctx.session.pageReady = true;

      // Запрашиваем капчу и ОСТАНАВЛИВАЕМСЯ - ждем ввода от пользователя
      await requestCaptchaFromUser(page, ctx, requestManualCaptchaFn);

      console.log('Форма заполнена, капча отправлена. Ждем ввода от пользователя...');
      // НЕ ЗАКРЫВАЕМ БРАУЗЕР - оставляем его открытым
      return;
    }

    // Если это повторная попытка с введенной капчей
    if (ctx.session.state === 'captcha_received' && ctx.session.manualCaptchaText) {
      console.log(`Получена капча от пользователя: "${ctx.session.manualCaptchaText}"`);

      const browserData = userBrowsers.get(userId);
      if (!browserData) {
        throw new Error('Браузер не найден. Начните процесс записи заново.');
      }

      const { browser, page } = browserData;

      // Проверяем, что браузер и страница еще активны
      try {
        if (!browser.isConnected || !browser.isConnected()) {
          throw new Error('Браузер отключен');
        }
        await page.evaluate(() => document.title);
      } catch (e) {
        console.log('Браузер или страница недоступны:', e.message);
        await closeBrowserSafely(userId);
        throw new Error('Страница недоступна. Начните процесс записи заново.');
      }

      // Вводим капчу в уже заполненную форму
      try {
        console.log('Вводим капчу в поле...');
        await page.fill('#fc_field_captcha_id', ctx.session.manualCaptchaText);
        console.log('Капча введена успешно');
      } catch (e) {
        console.error('Ошибка при вводе капчи:', e);
        await closeBrowserSafely(userId);
        throw new Error('Не удалось ввести капчу. Начните процесс записи заново.');
      }

      // ВАЖНО: Кликаем по кнопке "Записаться" и НЕ делаем никаких переходов
      console.log('Кликаем по кнопке "Записаться"...');
      await submitForm(page);

      // Ждем ответа от сервера (НЕ делаем переходов)
      console.log('Ждем ответа от сервера...');
      await page.waitForTimeout(5000);

      // Проверяем результат НА ТОЙ ЖЕ СТРАНИЦЕ
      const result = await checkSubmissionResult(page, ctx);

      if (result.success) {
        // Успешная запись
        const date = new Date(ctx.session.selectedDate);
        const { getMonthName } = require('../utils/dates');
        const displayDate = `${date.getDate()} ${getMonthName(date.getMonth())}`;

        await ctx.reply(
          `✅ *Успешная запись!*\n\n` +
          `📅 Дата: ${displayDate}\n` +
          `⏰ Время: ${ctx.session.selectedTime}\n\n` +
          `📋 Данные записи:\n` +
          `👤 ${ctx.session.donorData.name}\n` +
          `📞 ${ctx.session.donorData.phone}\n\n` +
          `💡 Не забудьте взять с собой паспорт и СНИЛС!`,
          { parse_mode: 'Markdown' }
        );

        // Очищаем данные и закрываем браузер
        ctx.session.state = 'ready';
        delete ctx.session.manualCaptchaText;
        delete ctx.session.pageReady;

        // Закрываем браузер
        await closeBrowserSafely(userId);

      } else if (result.captchaError) {
        // Неверная капча - запрашиваем новую БЕЗ перезагрузки
        await ctx.reply('❌ Неверная капча. Попробуем еще раз...');

        console.log('Запрашиваем новую капчу без перезагрузки...');

        // Очищаем старую капчу
        delete ctx.session.manualCaptchaText;
        ctx.session.state = 'waiting_captcha_input';

        // Запрашиваем новую капчу с той же страницы
        await requestCaptchaFromUser(page, ctx, requestManualCaptchaFn);

      } else {
        // Другая ошибка
        await ctx.reply(
          `❌ *Ошибка при записи*\n\n${result.errorMessage}\n\n` +
          `💡 Попробуйте записаться позже или обратитесь в центр напрямую.`,
          {
            parse_mode: 'Markdown',
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback('🔙 К выбору дат', 'back_to_dates')]
            ])
          }
        );

        // Очищаем состояние и закрываем браузер
        ctx.session.state = 'ready';
        delete ctx.session.manualCaptchaText;
        delete ctx.session.pageReady;

        await closeBrowserSafely(userId);
      }
    }

  } catch (error) {
    console.error('Ошибка при записи:', error);

    // Закрываем браузер при ошибке
    await closeBrowserSafely(userId);

    await ctx.reply(
      '❌ *Произошла ошибка при записи*\n\n' +
      '🔧 Возможно, сайт временно недоступен.\n' +
      '💡 Попробуйте позже или выберите другое время.',
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 К выбору дат', 'back_to_dates')]
        ])
      }
    );

    // Очищаем состояние
    ctx.session.state = 'ready';
    delete ctx.session.manualCaptchaText;
    delete ctx.session.pageReady;
  }
}



async function checkSubmissionResult(page, ctx) {
  try {
    console.log('Проверяем результат отправки формы...');

    // Ждем немного для обработки запроса
    await page.waitForTimeout(5000);

    // Проверяем, что страница еще доступна
    try {
      await page.evaluate(() => document.title);
    } catch (e) {
      console.log('Страница стала недоступна во время проверки результата');
      return {
        success: false,
        captchaError: false,
        errorMessage: 'Страница стала недоступна'
      };
    }

    // ОСНОВНАЯ ПРОВЕРКА: ищем div.uss_ok_form
    try {
      const successElement = await page.locator('.uss_ok_form').first();
      if (await successElement.isVisible({ timeout: 5000 })) {
        const successText = await successElement.textContent();
        console.log('Найдено сообщение об успехе:', successText);

        if (successText.includes('Заявка отправлена') ||
          successText.includes('письмо-уведомление')) {
          return { success: true };
        }
      }
    } catch (e) {
      console.log('Элемент .uss_ok_form не найден');
    }

    // Проверяем URL - если есть /send/, значит форма отправлена
    const currentUrl = page.url();
    console.log('Текущий URL:', currentUrl);

    if (currentUrl.includes('/send/')) {
      console.log('URL содержит /send/ - проверяем содержимое страницы');

      const pageContent = await page.content();
      if (pageContent.includes('uss_ok_form') ||
        pageContent.includes('Заявка отправлена') ||
        pageContent.includes('письмо-уведомление')) {
        console.log('Успех определен по содержимому страницы /send/');
        return { success: true };
      }
    }

    // Проверяем другие признаки успеха
    if (currentUrl.includes('success') || currentUrl.includes('thank') || currentUrl.includes('спасибо')) {
      console.log('Успех определен по URL');
      return { success: true };
    }

    // Проверяем наличие ошибок
    const errorSelectors = [
      '.error',
      '.alert-error',
      '.message-error',
      '[class*="error"]',
      '.notification-error'
    ];

    for (const selector of errorSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          const errorText = await element.textContent();
          console.log('Найдена ошибка:', errorText);

          // Проверяем, связана ли ошибка с капчей
          const isCaptchaError = errorText.toLowerCase().includes('капча') ||
            errorText.toLowerCase().includes('captcha') ||
            errorText.toLowerCase().includes('код') ||
            errorText.toLowerCase().includes('неверный');

          return {
            success: false,
            captchaError: isCaptchaError,
            errorMessage: errorText
          };
        }
      } catch (e) {
        // Продолжаем проверку
      }
    }

    // Проверяем, осталась ли капча на странице (признак ошибки)
    try {
      const captchaStillExists = await page.locator('#fc_field_captcha_id').isVisible({ timeout: 2000 });
      const captchaValue = await page.locator('#fc_field_captcha_id').inputValue();

      if (captchaStillExists && captchaValue === '') {
        console.log('Капча очистилась - возможно, ошибка капчи');
        return {
          success: false,
          captchaError: true,
          errorMessage: 'Неверная капча'
        };
      }

      if (captchaStillExists && captchaValue !== '') {
        console.log('Капча осталась заполненной - форма не отправилась');
        return {
          success: false,
          captchaError: false,
          errorMessage: 'Форма не была отправлена'
        };
      }
    } catch (e) {
      console.log('Ошибка при проверке капчи:', e.message);
    }

    // Если ничего явного не найдено, считаем что форма не отправилась
    console.log('Результат неопределен, считаем ошибкой');
    return {
      success: false,
      captchaError: false,
      errorMessage: 'Не удалось определить результат отправки'
    };

  } catch (error) {
    console.error('Ошибка при проверке результата:', error);
    return {
      success: false,
      captchaError: false,
      errorMessage: 'Ошибка при проверке результата отправки'
    };
  }
}

async function selectDateAndTimeDirectly(page, dateString, timeString) {
  try {
    console.log(`Прямой переход к дате ${dateString} и времени ${timeString}`);

    // Формируем URL с параметрами
    const baseUrl = 'https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/';
    const urlWithParams = `${baseUrl}?date=${dateString}&time=${timeString}`;

    console.log('Переходим по URL:', urlWithParams);

    // Переходим напрямую
    await page.goto(urlWithParams);

    // Ждем загрузки формы
    await page.waitForSelector('#fc_field_name_id', { timeout: 15000 });

    console.log('Форма загружена после прямого перехода');

  } catch (error) {
    console.error('Ошибка при прямом переходе:', error);
    throw error;
  }
}

async function submitForm(page) {
  try {
    console.log('Отправляем форму...');

    // Ищем конкретную кнопку "Записаться"
    const submitSelectors = [
      'input[type="submit"][name="sendsave"]',
      'input[value="Записаться"]',
      'input.submit.save.styler',
      'input[type="submit"]',
      'button[type="submit"]'
    ];

    let submitted = false;

    for (const selector of submitSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          console.log(`Найдена кнопка отправки: ${selector}`);
          await element.click();
          console.log(`Форма отправлена через: ${selector}`);
          submitted = true;
          break;
        }
      } catch (e) {
        console.log(`Селектор ${selector} не сработал:`, e.message);
        // Пробуем следующий селектор
      }
    }

    if (!submitted) {
      // Пробуем найти через JavaScript
      console.log('Пробуем найти кнопку через JavaScript...');

      const jsSubmitted = await page.evaluate(() => {
        // Ищем кнопку "Записаться" по разным критериям
        const submitButton =
          document.querySelector('input[name="sendsave"]') ||
          document.querySelector('input[value="Записаться"]') ||
          document.querySelector('input.submit.save.styler') ||
          document.querySelector('input[type="submit"]') ||
          document.querySelector('button[type="submit"]');

        if (submitButton) {
          console.log('Найдена кнопка отправки через JavaScript:', submitButton.outerHTML);
          submitButton.click();
          return true;
        }

        // Если не нашли кнопку, пробуем отправить форму
        const form = document.querySelector('form');
        if (form) {
          console.log('Отправляем форму через form.submit()');
          form.submit();
          return true;
        }

        return false;
      });

      if (jsSubmitted) {
        console.log('Форма отправлена через JavaScript');
        submitted = true;
      }
    }

    if (!submitted) {
      throw new Error('Не удалось найти кнопку отправки формы');
    }

    console.log('Форма отправлена, ждем ответа...');

  } catch (error) {
    console.error('Ошибка при отправке формы:', error);
    throw error;
  }
}


async function selectDateInCalendar(page, dateString) {
  try {
    console.log(`Выбираем дату в календаре: ${dateString}`);

    await page.waitForSelector('.donorform-calendars', { timeout: 15000 });

    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.getMonth();
    const year = date.getFullYear();

    console.log(`Ищем дату: день ${day}, месяц ${month}, год ${year}`);

    // Навигируем к нужному месяцу (если нужно)
    await navigateToMonthInBooking(page, month, year);
    await page.waitForTimeout(2000);

    // УПРОЩЕННЫЙ клик по дате - просто кликаем, не ждем URL
    const dateClicked = await page.evaluate((dateParams) => {
      const { targetDay } = dateParams;

      const activeCalendar = document.querySelector('.slick-active .donorform-calendar');
      if (!activeCalendar) {
        console.log('Активный календарь не найден');
        return false;
      }

      // Ищем все ячейки с датами (включая ссылки внутри)
      const dateCells = activeCalendar.querySelectorAll('.donorform-calendar__body td');

      for (const cell of dateCells) {
        const cellText = cell.textContent.trim();
        const cellDay = parseInt(cellText);

        if (cellDay === targetDay &&
          !cell.classList.contains('past') &&
          !cell.classList.contains('empty') &&
          !cell.classList.contains('busy') &&
          !cell.classList.contains('disabled')) {

          console.log(`Найдена дата ${cellDay}, кликаем`);

          // Ищем ссылку внутри ячейки
          const link = cell.querySelector('a');
          if (link) {
            console.log('Кликаем по ссылке внутри ячейки');
            link.click();
          } else {
            console.log('Кликаем по самой ячейке');
            cell.click();
          }

          return true;
        }
      }

      console.log(`Дата ${targetDay} не найдена или недоступна`);
      return false;
    }, {
      targetDay: day
    });

    if (!dateClicked) {
      throw new Error(`Не удалось кликнуть по дате ${day}.${month + 1}.${year}`);
    }

    console.log(`Дата выбрана, ждем появления времени...`);

    // Ждем появления времени (это главный индикатор успеха)
    await page.waitForSelector('.intervals-column', { timeout: 15000 });
    await page.waitForTimeout(3000);

    console.log('Время появилось после выбора даты');

  } catch (error) {
    console.error('Ошибка при выборе даты:', error);
    throw error;
  }
}


async function selectTimeSlot(page, timeString) {
  try {
    console.log(`Выбираем время: ${timeString}`);

    // Ждем полной загрузки времени
    await page.waitForSelector('.intervals-column', { timeout: 15000 });
    await page.waitForTimeout(2000);

    // УПРОЩЕННЫЙ клик по времени
    const timeSelected = await page.evaluate((params) => {
      const { targetTime } = params;

      console.log(`Ищем время: ${targetTime}`);

      // Ищем все элементы времени
      const timeElements = document.querySelectorAll(
        '.intervals-column-item a[data-value], .intervals-column-item a, a[data-value]'
      );

      console.log(`Найдено ${timeElements.length} элементов времени`);

      for (const element of timeElements) {
        const dataValue = element.getAttribute('data-value');
        const elementText = element.textContent.trim();

        console.log(`Проверяем: data-value="${dataValue}", текст="${elementText}"`);

        if (dataValue === targetTime || elementText.includes(targetTime)) {
          console.log(`Найдено время ${targetTime}, кликаем`);

          // Простой клик
          element.click();
          return true;
        }
      }

      // Если не нашли по data-value, ищем по тексту в любых элементах
      const allElements = document.querySelectorAll('.intervals-column-item');
      for (const item of allElements) {
        if (item.textContent.includes(targetTime) && !item.classList.contains('busy')) {
          const link = item.querySelector('a');
          if (link) {
            console.log(`Найдено время ${targetTime} в элементе, кликаем по ссылке`);
            link.click();
            return true;
          }
        }
      }

      return false;
    }, { targetTime: timeString });

    if (!timeSelected) {
      throw new Error(`Не найдено время: ${timeString}`);
    }

    console.log(`Время выбрано, ждем появления формы...`);

    // Ждем появления формы (главный индикатор успеха)
    await page.waitForSelector('#fc_field_name_id', { timeout: 15000 });
    await page.waitForTimeout(2000);

    console.log('Форма появилась после выбора времени');

  } catch (error) {
    console.error('Ошибка при выборе времени:', error);
    throw error;
  }
}



async function navigateToMonthInBooking(page, targetMonth, targetYear) {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      console.log(`Попытка навигации ${attempt + 1}/${maxAttempts} к месяцу ${targetMonth + 1}/${targetYear}`);

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
        await page.waitForTimeout(1000);
        continue;
      }

      console.log(`Текущий месяц: ${currentMonthData.month + 1}/${currentMonthData.year}`);

      if (currentMonthData.month === targetMonth && currentMonthData.year === targetYear) {
        console.log('Уже на нужном месяце');
        return true;
      }

      const currentDate = new Date(currentMonthData.year, currentMonthData.month);
      const targetDate = new Date(targetYear, targetMonth);

      if (targetDate > currentDate) {
        console.log('Переключаемся на следующий месяц');

        // Пробуем разные селекторы для кнопки "следующий"
        const nextSelectors = [
          '.slick-next:not(.slick-disabled)',
          '.slick-arrow.slick-next:not(.slick-disabled)',
          '.donorform-calendars .slick-next'
        ];

        let clicked = false;
        for (const selector of nextSelectors) {
          try {
            await page.click(selector, { timeout: 3000 });
            clicked = true;
            break;
          } catch (e) {
            console.log(`Селектор ${selector} не сработал`);
          }
        }

        if (!clicked) {
          console.log('Не удалось кликнуть кнопку "следующий месяц"');
          break;
        }

      } else {
        console
        console.log('Переключаемся на предыдущий месяц');

        // Пробуем разные селекторы для кнопки "предыдущий"
        const prevSelectors = [
          '.slick-prev:not(.slick-disabled)',
          '.slick-arrow.slick-prev:not(.slick-disabled)',
          '.donorform-calendars .slick-prev'
        ];

        let clicked = false;
        for (const selector of prevSelectors) {
          try {
            await page.click(selector, { timeout: 3000 });
            clicked = true;
            break;
          } catch (e) {
            console.log(`Селектор ${selector} не сработал`);
          }
        }

        if (!clicked) {
          console.log('Не удалось кликнуть кнопку "предыдущий месяц"');
          break;
        }
      }

      // Ждем обновления календаря
      await page.waitForTimeout(2000);

    } catch (error) {
      console.error('Ошибка при навигации по календарю:', error);
      break;
    }
  }

  console.log(`Не удалось переключиться на месяц ${targetMonth + 1}/${targetYear} за ${maxAttempts} попыток`);
  return false;
}

async function fillFormData(page, donorData) {
  try {
    console.log('Заполняем форму данными пользователя...');
    console.log('Исходная дата рождения:', donorData.birthDate);

    // Ждем загрузки формы
    await page.waitForSelector('#fc_field_name_id', { timeout: 15000 });
    await page.waitForTimeout(2000);

    // Заполняем имя
    console.log('Заполняем имя...');
    await page.click('#fc_field_name_id');
    await page.fill('#fc_field_name_id', '');
    await page.type('#fc_field_name_id', donorData.name, { delay: 100 });

    // Заполняем телефон
    console.log('Заполняем телефон...');
    const phoneDigits = donorData.phone.replace(/\D/g, '');
    const phoneForForm = phoneDigits.startsWith('7') ? phoneDigits.substring(1) : phoneDigits;

    await page.click('#fc_field_phone_id');
    await page.fill('#fc_field_phone_id', '');
    await page.type('#fc_field_phone_id', phoneForForm, { delay: 100 });

    // Заполняем email
    console.log('Заполняем email...');
    await page.click('#fc_field_email_id');
    await page.fill('#fc_field_email_id', '');
    await page.type('#fc_field_email_id', donorData.email, { delay: 100 });

    const normalizedBirthDate = normalizeBirthDate(donorData.birthDate) || ensureDateFormat(donorData.birthDate);
    console.log('Нормализованная дата рождения:', normalizedBirthDate);

    // Проверяем, что дата в правильном формате
    if (!normalizedBirthDate.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
      throw new Error(`Неправильный формат даты рождения: ${normalizedBirthDate}. Ожидается DD.MM.YYYY`);
    }

    let birthDateFilled = await fillBirthDateSimple(page, normalizedBirthDate);

    if (!birthDateFilled) {
      console.log('Простой способ не сработал, пробуем через JavaScript...');
      birthDateFilled = await fillBirthDateViaJS(page, normalizedBirthDate);
    }

    if (!birthDateFilled) {
      console.log('Пробуем через page.fill...');
      await page.click('#fc_field_birth_date_id');
      await page.fill('#fc_field_birth_date_id', normalizedBirthDate);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(500);

      const finalValue = await page.inputValue('#fc_field_birth_date_id');
      birthDateFilled = finalValue === normalizedBirthDate;
    }

    // Заполняем СНИЛС
    console.log('Заполняем СНИЛС...');
    await page.click('#fc_field_snils_id');
    await page.fill('#fc_field_snils_id', '');
    await page.type('#fc_field_snils_id', donorData.snils, { delay: 100 });

    console.log('Форма заполнена, проверяем результат...');

    // Проверяем заполненные значения
    const fieldValues = await page.evaluate(() => {
      return {
        name: document.querySelector('#fc_field_name_id')?.value || '',
        phone: document.querySelector('#fc_field_phone_id')?.value || '',
        email: document.querySelector('#fc_field_email_id')?.value || '',
        birthDate: document.querySelector('#fc_field_birth_date_id')?.value || '',
        snils: document.querySelector('#fc_field_snils_id')?.value || ''
      };
    });

    console.log('Проверка заполненных полей:', fieldValues);

    if (!fieldValues.birthDate) {
      console.error('Дата рождения не заполнилась!');
      await page.screenshot({ path: `birth_date_error_${Date.now()}.png` });
      throw new Error('Не удалось заполнить дату рождения');
    }

    console.log('Форма заполнена успешно');

  } catch (error) {
    console.error('Ошибка при заполнении формы:', error);
    throw error;
  }
}



async function fillBirthDateSimple(page, birthDate) {
  try {
    console.log('Заполняем дату рождения простым способом:', birthDate);

    // Кликаем на поле даты рождения
    await page.click('#fc_field_birth_date_id');
    await page.waitForTimeout(300);

    // Полностью очищаем поле
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);

    // Просто вводим дату как текст
    await page.type('#fc_field_birth_date_id', birthDate, { delay: 100 });

    // Нажимаем Tab для подтверждения ввода
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // Проверяем результат
    const finalValue = await page.inputValue('#fc_field_birth_date_id');
    console.log('Значение после простого ввода:', finalValue);

    return finalValue === birthDate;

  } catch (error) {
    console.error('Ошибка при простом заполнении даты:', error);
    return false;
  }
}
// Добавьте эту функцию в начало файла donor-form.js
function ensureDateFormat(dateString) {
  if (!dateString) return '';

  // Если дата уже в правильном формате DD.MM.YYYY
  if (dateString.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
    return dateString;
  }

  // Если дата в формате YYYY-MM-DD (ISO)
  const isoMatch = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [_, year, month, day] = isoMatch;
    return `${day}.${month}.${year}`;
  }

  // Если дата в формате YYYY/MM/DD
  const slashMatch = dateString.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashMatch) {
    const [_, year, month, day] = slashMatch;
    return `${day}.${month}.${year}`;
  }

  // Если дата в других форматах, пробуем разобрать
  const date = new Date(dateString);
  if (!isNaN(date.getTime())) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  }

  console.error('Не удалось преобразовать дату:', dateString);
  return dateString; // Возвращаем как есть
}


async function requestCaptchaFromUser(page, ctx, requestManualCaptchaFn) {
  try {
    console.log('Получаем капчу для пользователя...');

    // Ждем загрузки капчи
    await page.waitForSelector('.captcha_item img', { timeout: 10000 });

    // Получаем изображение капчи
    const captchaElement = await page.locator('.captcha_item img').first();
    const captchaImagePath = path.join(__dirname, '../temp', `captcha_${Date.now()}.png`);

    // Создаем папку temp если её нет
    const tempDir = path.dirname(captchaImagePath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Сохраняем скриншот капчи
    await captchaElement.screenshot({ path: captchaImagePath });

    console.log(`Капча сохранена: ${captchaImagePath}`);

    // ВАЖНО: НЕ делаем никаких переходов, просто отправляем капчу пользователю
    await requestManualCaptchaFn(ctx, captchaImagePath);

    // Сохраняем путь к изображению для последующего удаления
    ctx.session.currentCaptchaPath = captchaImagePath;

    console.log('Капча отправлена пользователю, ждем ввода...');
    // НЕ делаем никаких дополнительных действий - просто ждем

  } catch (error) {
    console.error('Ошибка при получении капчи:', error);
    await ctx.reply(
      '❌ *Не удалось получить капчу*\n\n' +
      '🔧 Возможно, сайт временно недоступен.\n' +
      '💡 Попробуйте позже.',
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🔙 К выбору дат', 'back_to_dates')]
        ])
      }
    );
  }
}


// Обработчики завершения процесса
process.on('SIGINT', () => {
  console.log('\n🛑 Получен сигнал SIGINT, завершаем работу...');
  cleanupBrowsers();
  setTimeout(() => {
    process.exit(0);
  }, 3000); // Даем 3 секунды на закрытие браузеров
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Получен сигнал SIGTERM, завершаем работу...');
  cleanupBrowsers();
  setTimeout(() => {
    process.exit(0);
  }, 3000);
});

process.on('exit', () => {
  console.log('👋 Процесс завершается');
});

// Обработчик необработанных исключений
process.on('uncaughtException', (error) => {
  console.error('❌ Необработанное исключение:', error);
  cleanupBrowsers();
  setTimeout(() => {
    process.exit(1);
  }, 3000);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Необработанное отклонение промиса:', reason);
  cleanupBrowsers();
});

module.exports = {
  bookAppointment,
  userBrowsers,
  closeBrowserSafely,
  cleanupBrowsers
};
