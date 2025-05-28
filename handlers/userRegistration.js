const { Markup } = require('telegraf');
const { canDonatePlasma } = require('../utils/dates');
const { checkAvailability, checkAvailabilityFromDate } = require('./booking');

async function startUserRegistration(ctx) {
  ctx.session.state = 'ask_donation_type';
  await ctx.reply('Здравствуйте! Расскажите немного о себе:');
  await ctx.reply('Вы сдавали кровь или плазму в последний раз?',
    Markup.inlineKeyboard([
      [Markup.button.callback('🩸 Кровь', 'donation_type_blood')],
      [Markup.button.callback('🟡 Плазму', 'donation_type_plasma')]
    ])
  );
}

async function handleDonationType(ctx, donationType) {
  ctx.session.donationType = donationType;
  ctx.session.state = 'ask_last_donation_date';

  const typeText = donationType === 'blood' ? 'кровь' : 'плазму';
  await ctx.editMessageText(
    `✅ Выбрано: ${typeText}\n\n` +
    `📅 Когда была последняя сдача?\n\n` +
    `💡 Введите дату в формате: ДД.ММ.ГГГГ\n` +
    `Например: 15.03.2024`
  );
}

async function handleLastDonationDate(ctx, text) {
  const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) {
    const [_, day, month, year] = match;
    const dateStr = `${year}-${month}-${day}`;
    const date = new Date(dateStr);

    if (!isNaN(date.getTime())) {
      ctx.session.lastDonationDate = dateStr;
      ctx.session.state = 'ask_name';
      await ctx.reply('✅ Дата сохранена!\n\nВведите ваше ФИО:');
    } else {
      await ctx.reply('❌ Неверная дата. Попробуйте ещё раз в формате ДД.ММ.ГГГГ');
    }
  } else {
    await ctx.reply('❌ Формат даты должен быть: ДД.ММ.ГГГГ\nНапример: 15.03.2024');
  }
}

async function handleName(ctx, text) {
  ctx.session.donorData = ctx.session.donorData || {};
  ctx.session.donorData.name = text;
  ctx.session.state = 'ask_phone';
  await ctx.reply('✅ ФИО сохранено!\n\nВведите ваш телефон:');
}

async function handlePhone(ctx, text) {
  ctx.session.donorData.phone = text;
  ctx.session.state = 'ask_email';
  await ctx.reply('✅ Телефон сохранен!\n\nВведите ваш email:');
}

async function handleEmail(ctx, text) {
  ctx.session.donorData.email = text;
  ctx.session.state = 'ask_birth_date';
  await ctx.reply('✅ Email сохранен!\n\nДата рождения (ДД.ММ.ГГГГ):');
}

async function handleBirthDate(ctx, text) {
  const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match) {
    const [_, day, month, year] = match;
    ctx.session.donorData.birthDate = `${year}-${month}-${day}`;
    ctx.session.state = 'ask_snils';
    await ctx.reply('✅ Дата рождения сохранена!\n\nВведите ваш СНИЛС:');
  } else {
    await ctx.reply('❌ Формат даты должен быть: ДД.ММ.ГГГГ');
  }
}

async function handleSnils(ctx, text) {
  ctx.session.donorData.snils = text;
  ctx.session.state = 'ready';

  const nextPossibleDate = new Date(ctx.session.lastDonationDate);
  if (ctx.session.donationType === 'blood') {
    nextPossibleDate.setDate(nextPossibleDate.getDate() + 30);
  } else {
    nextPossibleDate.setDate(nextPossibleDate.getDate() + 14);
  }

  await ctx.reply(`✅ Спасибо за регистрацию!

📋 Ваши данные сохранены:
👤 ФИО: ${ctx.session.donorData.name}
📞 Телефон: ${ctx.session.donorData.phone}
📧 Email: ${ctx.session.donorData.email}

🩸 Вы можете снова сдавать плазму после ${nextPossibleDate.toLocaleDateString()}.
🔍 Я буду следить за доступными датами и уведомлю вас!`);

  await checkAvailability(ctx);
}

async function handleUserDataInput(ctx, text, state) {
  switch (state) {
    case 'ask_last_donation_date':
      await handleLastDonationDate(ctx, text);
      break;
    case 'ask_name':
      await handleName(ctx, text);
      break;
    case 'ask_phone':
      await handlePhone(ctx, text);
      break;
    case 'ask_email':
      await handleEmail(ctx, text);
      break;
    case 'ask_birth_date':
      await handleBirthDate(ctx, text);
      break;
    case 'ask_snils':
      await handleSnils(ctx, text);
      break;
    default:
      await ctx.reply('❓ Не понял команду. Пожалуйста, следуйте инструкциям выше.');
  }
}

async function handleWaitingPeriod(ctx) {
  const lastDate = new Date(ctx.session.lastDonationDate);
  const waitDays = ctx.session.donationType === 'blood' ? 30 : 14;
  const nextPossibleDate = new Date(lastDate.getTime() + waitDays * 24 * 60 * 60 * 1000);

  await ctx.reply(
    `⏳ *Период ожидания*\n\n` +
    `📅 Вы можете записаться на плазму не раньше ${nextPossibleDate.toLocaleDateString()}\n\n` +
    `🔍 Я буду проверять доступные даты начиная с этого числа и уведомлю вас, когда появятся свободные места.`,
    { parse_mode: 'Markdown' }
  );

  try {
    await checkAvailabilityFromDate(ctx, nextPossibleDate);
  } catch (checkError) {
    console.error('Ошибка при проверке будущих дат:', checkError);
    await ctx.reply('🌐 Не удалось проверить будущие даты. Сайт может быть временно недоступен.');
  }
}

module.exports = {
  startUserRegistration,
  handleDonationType,
  handleUserDataInput,
  handleWaitingPeriod
};
