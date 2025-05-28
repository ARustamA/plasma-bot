#!/bin/bash

echo "🚀 Деплой Plasma Bot..."

# Обновляем код
git pull origin main

# Устанавливаем зависимости
npm install --production

# Устанавливаем браузеры для Playwright
npx playwright install chromium

# Создаем необходимые папки
mkdir -p temp
mkdir -p logs

# Перезапускаем сервис
sudo systemctl restart plasma-bot
sudo systemctl enable plasma-bot

echo "✅ Деплой завершен!"
echo "📊 Статус сервиса:"
sudo systemctl status plasma-bot
