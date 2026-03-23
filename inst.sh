#!/bin/bash
set -e

echo ""
echo "🛡 Установка официального MTProto Proxy с поддержкой рекламы"
echo "=========================================================="

# 1. Проверка Docker
if ! command -v docker &>/dev/null; then
    echo "📦 Установка Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh >/dev/null 2>&1
    echo "   ✅ Docker установлен"
fi

# 2. Очистка старых версий (чтобы освободить 443 порт)
echo "🛑 Удаление старых контейнеров (mtg)..."
docker rm -f mtg mtproxy 2>/dev/null || true

# 3. Генерация ключей
BASE_SECRET=$(head -c 16 /dev/urandom | xxd -ps -c 256)
DOMAIN_HEX=$(echo -n "google.com" | xxd -ps -c 256)
# Формируем dd-секрет для FakeTLS
SECRET="dd${BASE_SECRET}${DOMAIN_HEX}"

IP=$(curl -4 -s ifconfig.me || curl -4 -s icanhazip.com || hostname -I | awk '{print $1}')

echo ""
echo "========================================="
echo "🔑 Ваш БАЗОВЫЙ секрет для @MTProxybot:"
echo "   $BASE_SECRET"
echo "========================================="
echo ""
echo "⏳ Скрипт приостановлен."
echo "Прямо сейчас отправьте этот базовый секрет боту @MTProxybot."
echo "Бот выдаст вам Proxy Tag (длинную строку)."
echo "Скопируйте этот тег и вставьте его сюда."
echo "(Если хотите добавить тег позже, просто нажмите Enter)"
echo ""
read -p "Ваш Proxy Tag: " TAG

# 4. Запуск официального контейнера
echo "🚀 Запускаем сервер..."
if [ -z "$TAG" ]; then
    docker run -d --name mtproxy --restart always -p 443:443 \
      -e SECRET="$SECRET" \
      -e WORKERS=2 \
      telegrammessenger/mtproxy:latest >/dev/null
else
    docker run -d --name mtproxy --restart always -p 443:443 \
      -e SECRET="$SECRET" \
      -e TAG="$TAG" \
      -e WORKERS=2 \
      telegrammessenger/mtproxy:latest >/dev/null
fi

LINK="https://t.me/proxy?server=${IP}&port=443&secret=${SECRET}"

echo ""
echo "========================================="
echo "✅ Готово! Ваш новый MTProto Proxy работает."
echo "📎 Ссылка для подключения:"
echo "   $LINK"
echo "========================================="
