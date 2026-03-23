#!/bin/bash
set -e

echo ""
echo "🛡 Установка официального MTProto Proxy (Без FakeTLS) с поддержкой рекламы"
echo "=========================================================================="

# 1. Проверка Docker
if ! command -v docker &>/dev/null; then
    echo "📦 Установка Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh >/dev/null 2>&1
    echo "   ✅ Docker установлен"
fi

# 2. Очистка старых версий (освобождаем 443 порт)
echo "🛑 Удаление старых контейнеров (mtg, mtproxy)..."
docker rm -f mtg mtproxy 2>/dev/null || true

# 3. Генерация чистого ключа (32 символа, без 'dd' и домена)
SECRET=$(head -c 16 /dev/urandom | xxd -ps -c 256)
IP=$(curl -4 -s ifconfig.me || curl -4 -s icanhazip.com || hostname -I | awk '{print $1}')

echo ""
echo "========================================="
echo "🔑 Ваш СЕКРЕТ для @MTProxybot:"
echo "   $SECRET"
echo "========================================="
echo ""
echo "⏳ Скрипт приостановлен."
echo "Отправьте этот секрет боту @MTProxybot."
echo "Скопируйте полученный Proxy Tag и вставьте его сюда."
echo "(Если хотите добавить тег позже, просто нажмите Enter)"
echo ""
read -p "Ваш Proxy Tag: " TAG

# 4. Запуск официального контейнера
echo "🚀 Запускаем сервер..."
if [ -z "$TAG" ]; then
    docker run -d --name mtproxy --restart always -p 443:443 \
      -e SECRET="$SECRET" \
      -e WORKERS=2 \
      telegrammessenger/proxy:latest >/dev/null
else
    docker run -d --name mtproxy --restart always -p 443:443 \
      -e SECRET="$SECRET" \
      -e TAG="$TAG" \
      -e WORKERS=2 \
      telegrammessenger/proxy:latest >/dev/null
fi

LINK="https://t.me/proxy?server=${IP}&port=443&secret=${SECRET}"

echo ""
echo "========================================="
echo "✅ Готово! Ваш чистый MTProto Proxy работает."
echo "📎 Ссылка для подключения:"
echo "   $LINK"
echo "========================================="
