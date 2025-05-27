const { chromium } = require('playwright');
const { requestManualCaptcha } = require('./captcha');
const fs = require('fs');
const path = require('path');

async function testManualCaptcha() {
  let browser;

  try {
    console.log('Тестируем ручной ввод капчи...');

    browser = await chromium.launch({ headless: false });
    const page = await browser.newPage();

    await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');

    // Закрываем модальное окно
    try {
      await page.waitForSelector('.donorform-modal', { timeout: 5000 });
      await page.click('.js-donorform-modal-close');
      console.log('Модальное окно закрыто');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('Модальное окно не найдено');
    }

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
