const { canDonatePlasma, getMonthName } = require('../utils/dates');
const { checkAvailability, checkAvailabilityFromDate, startBooking } = require('./booking');
const { bookAppointment } = require('../services/donor-form');
const { requestManualCaptcha } = require('../utils/captcha');
const { Markup } = require('telegraf');
const fs = require('fs');

async function handleDateSelection(ctx, selectedDate) {
  ctx.session.selectedDate = selectedDate;

  const date = new Date(selectedDate);
  const displayDate = `${date.getDate()} ${getMonthName(date.getMonth())}`;

  await ctx.editMessageText(`✅ Выбрана дата: ${displayDate}\n🔍 Ищу свободное время...`);
  await startBooking(ctx);
}

async function handleTimeSelection(ctx, selectedTime) {
  ctx.session.selectedTime = selectedTime;

  const date = new Date(ctx.session.selectedDate);
  const displayDate = `${date.getDate()} ${getMonthName(date.getMonth())}`;

  await ctx.editMessageText(
    `✅ Выбрано время: ${selectedTime}\n📅 Дата: ${displayDate}\n\nПодтвердить запись?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Да, записать', 'confirm_booking_yes')],
      [Markup.button.callback('❌ Нет, отменить', 'confirm_booking_no')]
    ])
  );
}

async function handleBookingConfirmation(ctx, confirmation) {
  if (confirmation === 'yes') {
    await ctx.editMessageText('🔄 Начинаю запись...');
    await bookAppointment(ctx, requestManualCaptcha);
  } else {
    await ctx.editMessageText('❌ Запись отменена. Я продолжу проверять новые даты.');
  }
}

async function handleDateRefresh(ctx) {
  try {
    const canDonate = canDonatePlasma(ctx.session.lastDonationDate, ctx.session.donationType);

    if (canDonate) {
      await checkAvailability(ctx);
    } else {
      const lastDate = new Date(ctx.session.lastDonationDate);
      const waitDays = ctx.session.donationType === 'blood' ? 30 : 14;
      const nextPossibleDate = new Date(lastDate.getTime() + waitDays * 24 * 60 * 60 * 1000);
      await checkAvailabilityFromDate(ctx, nextPossibleDate);
    }
  } catch (error) {
    console.error('Ошибка при обновлении дат:', error);
    await ctx.editMessageText(
      '❌ Ошибка при обновлении списка дат. Попробуйте позже.',
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '🔄 Попробовать снова', callback_data: 'refresh_dates' }
          ]]
        }
      }
    );
  }
}

async function handleTimeRefresh(ctx, selectedDate) {
  ctx.session.selectedDate = selectedDate;
  await ctx.editMessageText('🔄 Обновляю доступное время...');

  try {
    await startBooking(ctx);
  } catch (error) {
    console.error('Ошибка при обновлении времени:', error);
    await ctx.editMessageText(
      '❌ Ошибка при обновлении времени. Попробуйте позже.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Попробовать снова', callback_data: `refresh_times_${selectedDate}` },
              { text: '🔙 К выбору дат', callback_data: 'back_to_dates' }
            ]
          ]
        }
      }
    );
  }
}

async function handleCaptchaCancel(ctx) {
  const userId = ctx.from.id;

  // Закрываем браузер если он открыт
  const { closeBrowserSafely } = require('./services/donor-form');
  await closeBrowserSafely(userId);

  // Очищаем состояние капчи
  ctx.session.state = 'ready';
  delete ctx.session.manualCaptchaText;
  delete ctx.session.pageReady;

  // Удаляем файл капчи если он есть
  if (ctx.session.currentCaptchaPath && fs.existsSync(ctx.session.currentCaptchaPath)) {
    try {
      fs.unlinkSync(ctx.session.currentCaptchaPath);
      console.log('🗑️ Файл капчи удален:', ctx.session.currentCaptchaPath);
    } catch (e) {
      console.log('⚠️ Ошибка при удалении файла капчи:', e.message);
    }
    delete ctx.session.currentCaptchaPath;
  }

  await ctx.editMessageText(
    '❌ *Запись отменена*\n\n' +
    '💡 Вы можете выбрать другое время или дату для записи.',
    {
      parse_mode: 'Markdown',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🔙 К выбору дат', 'back_to_dates')]
      ])
    }
  );
}

module.exports = {
  handleDateSelection,
  handleTimeSelection,
  handleBookingConfirmation,
  handleDateRefresh,
  handleTimeRefresh,
  handleCaptchaCancel
};
