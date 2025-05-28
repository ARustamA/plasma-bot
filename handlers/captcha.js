const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { requestManualCaptcha } = require('../utils/captcha');
const { bookAppointment } = require('../services/donor-form');

async function handleCaptchaInput(ctx, text) {
  const captchaText = text.trim();

  if (captchaText.length < 3) {
    await ctx.reply('❌ Слишком короткий текст. Пожалуйста, введите текст с картинки:');
    return;
  }

  ctx.session.manualCaptchaText = captchaText;
  ctx.session.state = 'captcha_received';

  await ctx.reply(`✅ Капча получена: "${captchaText}"\n🔄 Отправляю форму...`);

  // Удаляем файл капчи
  if (ctx.session.currentCaptchaPath && fs.existsSync(ctx.session.currentCaptchaPath)) {
    fs.unlinkSync(ctx.session.currentCaptchaPath);
    delete ctx.session.currentCaptchaPath;
  }

  // Продолжаем процесс записи с введенной капчей
  await bookAppointment(ctx, requestManualCaptcha);
}

async function handleTestCaptchaCommand(ctx) {
  await ctx.reply('🔍 Тестирую отправку капчи...');

  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://xn--66-6kcadbg3avshsx1aj7aza.xn--p1ai/donorform/');

    // Закрываем модальное окно
    try {
      await page.waitForSelector('.donorform-modal', { timeout: 5000 });
      await page.click('.js-donorform-modal-close');
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('Модальное окно не найдено');
    }

    // Получаем капчу
    await page.waitForSelector('.captcha_item img', { timeout: 10000 });
    const captchaElement = await page.locator('.captcha_item img').first();

    const testDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    const captchaPath = path.join(testDir, `test_captcha_${Date.now()}.png`);
    await captchaElement.screenshot({ path: captchaPath });

    // Устанавливаем состояние теста капчи
    ctx.session.state = 'testing_captcha';
    ctx.session.testCaptchaPath = captchaPath;

    // Отправляем капчу пользователю
    await ctx.replyWithPhoto({ source: captchaPath }, {
      caption: '🔤 Введите текст с картинки для завершения теста:'
    });

  } catch (error) {
    console.error('Ошибка тестирования капчи:', error);
    await ctx.reply('❌ Ошибка при тестировании капчи');
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function handleTestCaptchaInput(ctx, text) {
  const captchaText = text.trim();

  if (captchaText.length < 3) {
    await ctx.reply('❌ Слишком короткий текст. Попробуйте еще раз:');
    return;
  }

  await ctx.reply(`✅ Тест завершен!\n\nВы ввели: "${captchaText}"\n\n💡 В реальной записи этот текст будет автоматически вставлен в форму.`);

  // Удаляем тестовый файл капчи
  if (ctx.session.testCaptchaPath && fs.existsSync(ctx.session.testCaptchaPath)) {
    fs.unlinkSync(ctx.session.testCaptchaPath);
    delete ctx.session.testCaptchaPath;
  }

  // Сбрасываем состояние
  ctx.session.state = 'ready';
}

module.exports = {
  handleCaptchaInput,
  handleTestCaptchaCommand,
  handleTestCaptchaInput
};
