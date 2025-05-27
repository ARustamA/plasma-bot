async function askNextStep(ctx) {
  const state = ctx.session.state;
  const text = ctx.message.text.toLowerCase();

  if (state === 'ask_donation_type') {
    if (['кровь', 'плазма'].includes(text)) {
      ctx.session.donationType = text === 'кровь' ? 'blood' : 'plasma';
      ctx.session.state = 'ask_last_donation_date';
      await ctx.reply('Когда была последняя сдача? (формат: ДД.ММ.ГГГГ)');
    } else {
      await ctx.reply('Пожалуйста, введите "кровь" или "плазма".');
    }
  } else if (state === 'ask_last_donation_date') {
    const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) {
      const [_, day, month, year] = match;
      const dateStr = `${year}-${month}-${day}`;
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        ctx.session.lastDonationDate = dateStr;
        ctx.session.state = 'ask_name';
        await ctx.reply('Введите ваше ФИО:');
      } else {
        await ctx.reply('Неверная дата. Попробуйте ещё раз.');
      }
    } else {
      await ctx.reply('Формат даты должен быть: ДД.ММ.ГГГГ');
    }
  } else if (ctx.session.state === 'ask_name') {
    ctx.session.donorData = ctx.session.donorData || {};
    ctx.session.donorData.name = text;
    ctx.session.state = 'ask_phone';
    await ctx.reply('Введите ваш телефон:');
  } else if (ctx.session.state === 'ask_phone') {
    ctx.session.donorData.phone = text;
    ctx.session.state = 'ask_email';
    await ctx.reply('Введите ваш email:');
  } else if (ctx.session.state === 'ask_email') {
    ctx.session.donorData.email = text;
    ctx.session.state = 'ask_birth_date';
    await ctx.reply('Дата рождения (ДД.ММ.ГГГГ):');
  } else if (ctx.session.state === 'ask_birth_date') {
    const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (match) {
      const [_, day, month, year] = match;
      ctx.session.donorData.birthDate = `${year}-${month}-${day}`;
      ctx.session.state = 'ask_snils';
      await ctx.reply('Введите ваш СНИЛС:');
    } else {
      await ctx.reply('Формат даты должен быть: ДД.ММ.ГГГГ');
    }
  } else if (ctx.session.state === 'ask_snils') {
    ctx.session.donorData.snils = text;
    ctx.session.state = 'ready';

    const nextPossibleDate = new Date(ctx.session.lastDonationDate);
    if (ctx.session.donationType === 'blood') {
      nextPossibleDate.setDate(nextPossibleDate.getDate() + 30);
    } else {
      nextPossibleDate.setDate(nextPossibleDate.getDate() + 14);
    }

    await ctx.reply(`Спасибо за регистрацию!
Вы можете снова сдавать плазму после ${nextPossibleDate.toLocaleDateString()}.
Я буду следить за доступными датами.`);

    const { checkAvailability } = require('../handlers/booking');
    await checkAvailability(ctx);
  }
}

module.exports = { askNextStep };