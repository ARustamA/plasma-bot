const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
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

async function bookAppointment(ctx, requestManualCaptchaFn) {
  let browser;
  let page;

  try {
    console.log('Начинаем процесс записи...');

    browser = await chromium.launch({ headless: false });
    page = await browser.newPage();

    // Переходим на страницу записи
    await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');

    // Закрываем модальное окно если оно появилось
    await closeModalIfExists(page);
    await page.waitForTimeout(1000);

    // Заполняем форму данными пользователя
    await fillFormData(page, ctx.session.donorData);

    // Если это повторная попытка с введенной капчей
    if (ctx.session.state === 'captcha_received' && ctx.session.manualCaptchaText) {
      console.log(`Используем введенную пользователем капчу: "${ctx.session.manualCaptchaText}"`);

      // Вводим капчу
      await page.fill('input[name="captcha"]', ctx.session.manualCaptchaText);

      // Отправляем форму
      await page.click('button[type="submit"]');

      // Ждем результата
      await page.waitForTimeout(3000);

      // Проверяем результат
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

        // Очищаем данные капчи
        ctx.session.state = 'ready';
        delete ctx.session.manualCaptchaText;

      } else if (result.captchaError) {
        // Неверная капча - запрашиваем новую
        await ctx.reply('❌ Неверная капча. Попробуем еще раз...');

        // Перезагружаем страницу для новой капчи
        await page.reload();
        await closeModalIfExists(page);
        await page.waitForTimeout(1000);
        await fillFormData(page, ctx.session.donorData);

        // Запрашиваем новую капчу
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
        ctx.session.state = 'ready';
        delete ctx.session.manualCaptchaText;
      }

    } else {
      // Первая попытка - запрашиваем капчу
      await requestCaptchaFromUser(page, ctx, requestManualCaptchaFn);
    }

  } catch (error) {
    console.error('Ошибка при записи:', error);
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

  } finally {
    if (browser) {
      await browser.close();
    }
  }
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

    // Отправляем капчу пользователю
    await requestManualCaptchaFn(ctx, captchaImagePath);

    // Сохраняем путь к изображению для последующего удаления
    ctx.session.currentCaptchaPath = captchaImagePath;

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

async function checkSubmissionResult(page, ctx) {
  try {
    // Проверяем наличие сообщений об успехе или ошибке
    const successSelectors = [
      '.success',
      '.alert-success',
      '.message-success',
      '[class*="success"]'
    ];

    const errorSelectors = [
      '.error',
      '.alert-error',
      '.message-error',
      '[class*="error"]'
    ];

    // Проверяем успех
    for (const selector of successSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.isVisible()) {
          const text = await element.textContent();
          console.log('Найдено сообщение об успехе:', text);
          return { success: true };
        }
      } catch (e) {
        // Продолжаем проверку
      }
    }

    // Проверяем ошибки
    for (const selector of errorSelectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.isVisible()) {
          const errorText = await element.textContent();
          console.log('Найдена ошибка:', errorText);

          // Проверяем, связана ли ошибка с капчей
          const isCaptchaError = errorText.toLowerCase().includes('капча') ||
            errorText.toLowerCase().includes('captcha') ||
            errorText.toLowerCase().includes('код');

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

    // Если нет явных сообщений, проверяем URL или другие признаки
    const currentUrl = page.url();
    if (currentUrl.includes('success') || currentUrl.includes('thank')) {
      return { success: true };
    }

    // Проверяем, осталась ли капча на странице (признак ошибки)
    try {
      const captchaStillExists = await page.locator('.captcha_item img').isVisible();
      if (captchaStillExists) {
        return {
          success: false,
          captchaError: true,
          errorMessage: 'Форма не была отправлена'
        };
      }
    } catch (e) {
      // Капча исчезла - возможно, успех
    }

    // По умолчанию считаем успехом, если нет явных ошибок
    return { success: true };

  } catch (error) {
    console.error('Ошибка при проверке результата:', error);
    return {
      success: false,
      captchaError: false,
      errorMessage: 'Не удалось определить результат отправки'
    };
  }
}

async function fillFormData(page, donorData) {
  try {
    console.log('Заполняем форму данными пользователя...');

    // Ждем загрузки формы
    await page.waitForSelector('input[name="name"]', { timeout: 10000 });

    // Заполняем форму данными пользователя
    await page.fill('input[name="name"]', donorData.name);
    await page.fill('input[name="phone"]', donorData.phone);
    await page.fill('input[name="email"]', donorData.email);
    await page.fill('input[name="birth_date"]', donorData.birthDate);
    await page.fill('input[name="snils"]', donorData.snils);

    console.log('Форма заполнена успешно');
  } catch (error) {
    console.error('Ошибка при заполнении формы:', error);
    throw error;
  }
}

module.exports = { bookAppointment };

