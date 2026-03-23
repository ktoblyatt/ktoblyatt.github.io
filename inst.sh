#!/bin/bash
# =============================================================================
#  MTProto Proxy — Автоустановщик (mtg v2 + Fake TLS)
#  Работает в РФ в условиях блокировок РКН / DPI / ТСПУ
#  Основан на: github.com/9seconds/mtg (v2)
#
#  Поддерживаемые ОС: Ubuntu 20.04+, Debian 11+, CentOS 8+
#  Требования: root, Docker ИЛИ доступ к apt/yum
# =============================================================================

set -euo pipefail

# ─── Цвета ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; exit 1; }

# ─── Параметры по умолчанию ──────────────────────────────────────────────────
DEFAULT_PORT=443
# Домен для Fake TLS маскировки.
# Выбирайте домен, популярный у вашего хостинга / провайдера.
# НЕ используйте google.com/cloudflare.com — их ASN не совпадают с VPS.
# Хорошие варианты для РФ-хостингов: selectel.ru, timeweb.com, beget.com
DEFAULT_CLOAK_DOMAIN="www.microsoft.com"
CONTAINER_NAME="mtproto-proxy"
CONFIG_DIR="/etc/mtg"
CONFIG_FILE="$CONFIG_DIR/config.toml"
STATE_FILE="$CONFIG_DIR/proxy.env"

# ─── Баннер ──────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════╗"
echo "║        MTProto Proxy — Установщик (mtg v2)           ║"
echo "║        Fake TLS | Защита от РКН / DPI / ТСПУ         ║"
echo "╚══════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── Проверка root ───────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Запустите скрипт от root: sudo bash $0"

# ─── Определение ОС ──────────────────────────────────────────────────────────
detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS_ID="${ID}"
        OS_VER="${VERSION_ID:-}"
    else
        error "Не удалось определить ОС"
    fi
    info "Система: $PRETTY_NAME"
}

# ─── Интерактивный ввод параметров ───────────────────────────────────────────
ask_params() {
    echo ""
    echo -e "${BOLD}=== Настройка прокси ===${NC}"
    echo ""

    # Порт
    read -rp "$(echo -e "${CYAN}Порт для прокси${NC} [${DEFAULT_PORT}]: ")" INPUT_PORT
    PORT="${INPUT_PORT:-$DEFAULT_PORT}"
    if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
        error "Некорректный порт: $PORT"
    fi

    # Домен маскировки Fake TLS
    echo ""
    echo -e "  ${YELLOW}Совет по домену Fake TLS:${NC}"
    echo "  Домен должен быть популярным и доступным HTTPS-сайтом."
    echo "  Для VPS в РФ: selectel.ru, timeweb.com, beget.com, vk.com"
    echo "  Для VPS вне РФ: www.microsoft.com, bing.com, yahoo.com"
    echo ""
    read -rp "$(echo -e "${CYAN}Домен для Fake TLS маскировки${NC} [${DEFAULT_CLOAK_DOMAIN}]: ")" INPUT_DOMAIN
    CLOAK_DOMAIN="${INPUT_DOMAIN:-$DEFAULT_CLOAK_DOMAIN}"

    echo ""
    info "Порт:           $PORT"
    info "Домен Fake TLS: $CLOAK_DOMAIN"
    echo ""
}

# ─── Установка Docker ─────────────────────────────────────────────────────────
install_docker() {
    if command -v docker &>/dev/null; then
        success "Docker уже установлен: $(docker --version)"
        return
    fi

    info "Устанавливаю Docker..."
    case "$OS_ID" in
        ubuntu|debian)
            apt-get update -qq
            apt-get install -y -qq ca-certificates curl gnupg lsb-release
            install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/${OS_ID}/gpg \
                | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            chmod a+r /etc/apt/keyrings/docker.gpg
            echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${OS_ID} $(lsb_release -cs) stable" \
                > /etc/apt/sources.list.d/docker.list
            apt-get update -qq
            apt-get install -y -qq docker-ce docker-ce-cli containerd.io
            ;;
        centos|rhel|fedora|rocky|almalinux)
            yum install -y -q yum-utils
            yum-config-manager --add-repo \
                https://download.docker.com/linux/centos/docker-ce.repo
            yum install -y -q docker-ce docker-ce-cli containerd.io
            ;;
        *)
            warn "Неизвестная ОС '$OS_ID'. Пробую универсальный установщик Docker..."
            curl -fsSL https://get.docker.com | bash
            ;;
    esac

    systemctl enable --now docker
    success "Docker установлен и запущен"
}

# ─── Генерация секрета (Fake TLS) ─────────────────────────────────────────────
generate_secret() {
    info "Генерирую Fake TLS секрет для домена: $CLOAK_DOMAIN"
    SECRET=$(docker run --rm nineseconds/mtg:2 generate-secret --hex "$CLOAK_DOMAIN" 2>/dev/null)
    if [[ -z "$SECRET" ]]; then
        error "Не удалось сгенерировать секрет. Проверьте подключение к Docker Hub."
    fi
    success "Секрет сгенерирован: $SECRET"
}

# ─── Определение внешнего IP ──────────────────────────────────────────────────
get_public_ip() {
    PUBLIC_IP=$(curl -4 -fsSL --max-time 5 https://api.ipify.org 2>/dev/null \
        || curl -4 -fsSL --max-time 5 https://ifconfig.me 2>/dev/null \
        || curl -4 -fsSL --max-time 5 https://icanhazip.com 2>/dev/null \
        || echo "")
    if [[ -z "$PUBLIC_IP" ]]; then
        warn "Не удалось определить публичный IP автоматически"
        read -rp "Введите IP вашего сервера вручную: " PUBLIC_IP
    fi
    success "Публичный IP: $PUBLIC_IP"
}

# ─── Настройка файрвола ───────────────────────────────────────────────────────
configure_firewall() {
    info "Открываю порт $PORT в файрволе..."
    if command -v ufw &>/dev/null; then
        ufw allow "$PORT"/tcp &>/dev/null && success "ufw: порт $PORT открыт"
    fi
    if command -v firewall-cmd &>/dev/null; then
        firewall-cmd --permanent --add-port="$PORT"/tcp &>/dev/null
        firewall-cmd --reload &>/dev/null && success "firewalld: порт $PORT открыт"
    fi
    # iptables как запасной вариант
    if command -v iptables &>/dev/null; then
        iptables -C INPUT -p tcp --dport "$PORT" -j ACCEPT &>/dev/null \
            || iptables -I INPUT -p tcp --dport "$PORT" -j ACCEPT
    fi
}

# ─── Запуск контейнера ────────────────────────────────────────────────────────
start_proxy() {
    info "Останавливаю старый контейнер (если есть)..."
    docker stop "$CONTAINER_NAME" &>/dev/null || true
    docker rm "$CONTAINER_NAME" &>/dev/null || true

    info "Запускаю MTProto прокси..."
    docker run -d \
        --name "$CONTAINER_NAME" \
        --restart unless-stopped \
        -p "${PORT}:${PORT}" \
        nineseconds/mtg:2 \
        simple-run \
        -n 1.1.1.1 \
        -i prefer-ipv4 \
        "0.0.0.0:${PORT}" \
        "$SECRET"

    sleep 3

    if docker ps --filter "name=$CONTAINER_NAME" --filter "status=running" | grep -q "$CONTAINER_NAME"; then
        success "Контейнер запущен успешно"
    else
        error "Контейнер не запустился. Логи:\n$(docker logs $CONTAINER_NAME 2>&1)"
    fi
}

# ─── Сохранение состояния ─────────────────────────────────────────────────────
save_state() {
    mkdir -p "$CONFIG_DIR"
    cat > "$STATE_FILE" <<EOF
PORT=$PORT
SECRET=$SECRET
CLOAK_DOMAIN=$CLOAK_DOMAIN
PUBLIC_IP=$PUBLIC_IP
CONTAINER_NAME=$CONTAINER_NAME
INSTALLED_AT=$(date '+%Y-%m-%d %H:%M:%S')
EOF
    chmod 600 "$STATE_FILE"
    success "Конфигурация сохранена в $STATE_FILE"
}

# ─── Формирование ссылок ──────────────────────────────────────────────────────
print_result() {
    TG_URL="tg://proxy?server=${PUBLIC_IP}&port=${PORT}&secret=${SECRET}"
    TME_URL="https://t.me/proxy?server=${PUBLIC_IP}&port=${PORT}&secret=${SECRET}"

    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗"
    echo -e "║              ✅  ПРОКСИ ГОТОВ К РАБОТЕ              ║"
    echo -e "╚══════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${BOLD}Сервер:${NC}  $PUBLIC_IP"
    echo -e "  ${BOLD}Порт:${NC}    $PORT"
    echo -e "  ${BOLD}Секрет:${NC}  $SECRET"
    echo -e "  ${BOLD}Тип:${NC}     MTProto + Fake TLS (→ $CLOAK_DOMAIN)"
    echo ""
    echo -e "  ${BOLD}🔗 Ссылка для Telegram:${NC}"
    echo -e "  ${CYAN}$TG_URL${NC}"
    echo ""
    echo -e "  ${BOLD}🌐 Ссылка t.me (для публикации):${NC}"
    echo -e "  ${CYAN}$TME_URL${NC}"
    echo ""
    echo -e "  ${YELLOW}📌 Для @MTProxybot введите:${NC}"
    echo -e "     Сервер: ${BOLD}$PUBLIC_IP${NC}"
    echo -e "     Порт:   ${BOLD}$PORT${NC}"
    echo -e "     Ключ:   ${BOLD}$SECRET${NC}"
    echo ""
    echo -e "  ${BOLD}Полезные команды:${NC}"
    echo -e "  Статус:    ${CYAN}docker ps --filter name=$CONTAINER_NAME${NC}"
    echo -e "  Логи:      ${CYAN}docker logs -f $CONTAINER_NAME${NC}"
    echo -e "  Перезапуск:${CYAN}docker restart $CONTAINER_NAME${NC}"
    echo -e "  Остановка: ${CYAN}docker stop $CONTAINER_NAME${NC}"
    echo -e "  Удаление:  ${CYAN}docker rm -f $CONTAINER_NAME${NC}"
    echo ""
    echo -e "  ${YELLOW}⚠️  Совет по Fake TLS:${NC}"
    echo -e "  Если РКН начнёт активно зондировать ваш IP, смените домен маскировки."
    echo -e "  Запустите скрипт повторно и выберите другой домен."
    echo ""
}

# ─── Проверка подключения ─────────────────────────────────────────────────────
check_connectivity() {
    info "Проверяю доступность порта $PORT снаружи..."
    # Простой TCP-тест через nc (если доступен)
    if command -v nc &>/dev/null; then
        if nc -z -w5 "$PUBLIC_IP" "$PORT" &>/dev/null; then
            success "Порт $PORT доступен снаружи ✓"
        else
            warn "Порт $PORT не отвечает снаружи. Проверьте файрвол вашего VPS-провайдера."
            warn "Часто нужно открыть порт в панели управления хостингом (Security Groups / Firewall)."
        fi
    fi
}

# ─── Главный сценарий ─────────────────────────────────────────────────────────
main() {
    detect_os
    ask_params
    install_docker
    get_public_ip
    generate_secret
    configure_firewall
    start_proxy
    save_state
    check_connectivity
    print_result
}

main
