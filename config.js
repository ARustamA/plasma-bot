require('dotenv').config();

const config = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  TELEGRAM_USER_ID: process.env.TELEGRAM_USER_ID,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000
};

// Проверяем обязательные переменные
if (!config.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не установлен!');
  process.exit(1);
}

if (!config.TELEGRAM_USER_ID) {
  console.error('❌ TELEGRAM_USER_ID не установлен!');
  process.exit(1);
}

console.log('✅ Конфигурация загружена:', {
  NODE_ENV: config.NODE_ENV,
  BOT_TOKEN: config.BOT_TOKEN ? '***установлен***' : 'не установлен',
  TELEGRAM_USER_ID: config.TELEGRAM_USER_ID ? '***установлен***' : 'не установлен'
});

module.exports = config;
