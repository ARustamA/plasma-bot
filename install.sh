#!/bin/bash

echo "🚀 Установка Plasma Bot..."

# Обновляем систему
apt update && apt upgrade -y

# Устанавливаем Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Устанавливаем дополнительные зависимости для Playwright
apt install -y \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxkbcommon0 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  libgbm1 \
  libxss1 \
  libasound2

# Переходим в папку проекта
cd /root/plasma-bot

# Устанавливаем зависимости
npm install

# Устанавливаем браузер для Playwright
npx playwright install chromium

# Создаем необходимые папки
mkdir -p temp logs

# Создаем .env файл (нужно будет отредактировать)
cp .env.example .env

echo "✅ Установка завершена!"
echo "📝 Не забудьте отредактировать файл .env с вашими токенами"
echo "🚀 Для запуска используйте: npm start"
