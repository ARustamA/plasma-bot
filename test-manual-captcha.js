const { chromium } = require('playwright');
const { requestManualCaptcha } = require('./utils/captcha');
const fs = require('fs');
const path = require('path');

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
    return true;
  } catch (error) {
    console.log('Модальное окно не найдено или уже закрыто');
    return false;
  }
}

async function testManualCaptcha() {
  let browser;

  try {
    console.log('Тестируем ручной ввод капчи...');

    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');

    // Закрываем модальное окно
    await closeModalIfExists(page);
    await page.waitForTimeout(1000);

    // Получаем капчу
    await page.waitForSelector('.captcha_item img', { timeout: 10000 });
    const captchaElement = await page.locator('.captcha_item img').first();

    const testDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const captchaPath = path.join(testDir, `manual_test_captcha_${Date.now()}.png`);
    await captchaElement.screenshot({ path: captchaPath });

    console.log(`Капча сохранена: ${captchaPath}`);
    console.log('Файл существует:', fs.existsSync(captchaPath));

    // Имитируем контекст бота
    const mockCtx = {
      replyWithPhoto: async (photo, options) => {
        console.log('📸 Отправляем фото:', photo.source);
        console.log('📝 Подпись:', options.caption);
        console.log('✅ Фото успешно "отправлено"');
        return Promise.resolve();
      },
      reply: async (text) => {
        console.log('💬 Сообщение:', text);
        return Promise.resolve();
      },
      session: {}
    };

    // Тестируем функцию отправки капчи
    await requestManualCaptcha(mockCtx, captchaPath);

    console.log('✅ Тест завершен успешно');
    console.log('Состояние сессии:', mockCtx.session);

    // Удаляем тестовый файл
    if (fs.existsSync(captchaPath)) {
      fs.unlinkSync(captchaPath);
      console.log('🗑️ Тестовый файл удален');
    }

    await page.waitForTimeout(3000);

  } catch (error) {
    console.error('❌ Ошибка при тестировании:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Запускаем тест
testManualCaptcha();
