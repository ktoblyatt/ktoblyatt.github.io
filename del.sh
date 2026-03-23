#!/bin/bash
echo "🧹 Полное удаление MTProto Proxy..."

# 1. Останавливаем и удаляем контейнеры
echo "🛑 Остановка и удаление контейнеров..."
docker rm -f mtg mtproxy 2>/dev/null || true

# 2. Удаляем старые конфигурационные файлы mtg
echo "🗑 Удаление конфигурационных файлов..."
rm -rf /opt/mtg

# 3. Удаляем образы Docker (чтобы освободить дисковое пространство)
echo "📦 Удаление образов Docker..."
docker rmi nineseconds/mtg:2 telegrammessenger/mtproxy:latest 2>/dev/null || true

echo "✅ Готово! Сервер полностью очищен от MTProto, порт 443 свободен."
