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
  const digits = text.replace(/\D/g, '');

  if (digits.length < 10) {
    await ctx.reply('❌ Номер телефона слишком короткий. Введите полный номер телефона:');
    return;
  }

  if (digits.length > 11) {
    await ctx.reply('❌ Номер телефона слишком длинный. Введите корректный номер:');
    return;
  }

  const normalizedPhone = normalizePhoneNumber(text);
  ctx.session.donorData.phone = normalizedPhone;
  ctx.session.state = 'ask_email';

  await ctx.reply(`✅ Телефон сохранен: ${normalizedPhone}\n\nВведите ваш email:`);
}

function normalizePhoneNumber(phone) {
  let digits = phone.replace(/\D/g, '');

  if (digits.startsWith('8')) {
    digits = '7' + digits.substring(1);
  }

  if (digits.startsWith('7') && digits.length === 11) {
    digits = digits.substring(1);
  }

  if (!digits.startsWith('9') && digits.length === 10) {
    digits = '7' + digits;
  }

  if (digits.length === 10 && digits.startsWith('9')) {
    return `+7 (${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6, 8)}-${digits.substring(8, 10)}`;
  }

  if (digits.length === 11 && digits.startsWith('7')) {
    return `+7 (${digits.substring(1, 4)}) ${digits.substring(4, 7)}-${digits.substring(7, 9)}-${digits.substring(9, 11)}`;
  }

  return phone;
}

async function handleEmail(ctx, text) {
  ctx.session.donorData.email = text;
  ctx.session.state = 'ask_birth_date';
  await ctx.reply('✅ Email сохранен!\n\nДата рождения (ДД.ММ.ГГГГ):');
}

async function handleBirthDate(ctx, text) {
  const normalizedDate = normalizeBirthDate(text);

  if (normalizedDate) {
    const [day, month, year] = normalizedDate.split('.');
    const birthDate = new Date(year, month - 1, day);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < 18) {
      await ctx.reply('❌ Возраст должен быть не менее 18 лет. Введите корректную дату рождения в формате ДД.ММ.ГГГГ:');
      return;
    }

    if (age > 100) {
      await ctx.reply('❌ Проверьте правильность введенной даты. Введите дату рождения в формате ДД.ММ.ГГГГ:');
      return;
    }

    if (!ctx.session.donorData) {
      ctx.session.donorData = {};
    }

    ctx.session.donorData.birthDate = normalizedDate;
    ctx.session.state = 'ask_snils';

    await ctx.reply(`✅ Дата рождения сохранена: ${normalizedDate}\n\nВведите ваш СНИЛС:`);
  } else {
    await ctx.reply(
      '❌ Неверный формат даты рождения.\n\n' +
      '📝 Введите дату в формате ДД.ММ.ГГГГ\n' +
      'Например: 27.07.1992\n\n' +
      'Попробуйте еще раз:'
    );
  }
}

function normalizeBirthDate(date) {
  const digits = date.replace(/\D/g, '');

  if (digits.length === 8) {
    const day = digits.substring(0, 2);
    const month = digits.substring(2, 4);
    const year = digits.substring(4, 8);

    const dateObj = new Date(year, month - 1, day);
    if (dateObj.getFullYear() == year &&
      dateObj.getMonth() == month - 1 &&
      dateObj.getDate() == day) {
      return `${day}.${month}.${year}`;
    }
  }

  const formats = [
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/
  ];

  for (const format of formats) {
    const match = date.match(format);
    if (match) {
      const day = match[1].padStart(2, '0');
      const month = match[2].padStart(2, '0');
      const year = match[3];

      const dateObj = new Date(year, month - 1, day);
      if (dateObj.getFullYear() == year &&
        dateObj.getMonth() == month - 1 &&
        dateObj.getDate() == day) {
        return `${day}.${month}.${year}`;
      }
    }
  }

  return '';
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
  handleWaitingPeriod,
  normalizeBirthDate
};