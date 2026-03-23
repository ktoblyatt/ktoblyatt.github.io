#!/bin/bash
# =============================================================================
#  MTProto Proxy — Управление (mtg v2 + Fake TLS)
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

# ─── Константы ───────────────────────────────────────────────────────────────
DEFAULT_PORT=443
DEFAULT_CLOAK_DOMAIN="www.microsoft.com"
CONTAINER_NAME="mtproto-proxy"
CONFIG_DIR="/etc/mtg"
STATE_FILE="$CONFIG_DIR/proxy.env"

# ─── Проверка root ───────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Запустите скрипт от root: sudo bash $0"

# ─── Баннер ──────────────────────────────────────────────────────────────────
print_banner() {
    clear
    echo -e "${BOLD}"
    echo "╔══════════════════════════════════════════════════════╗"
    echo "║        MTProto Proxy — Управление (mtg v2)           ║"
    echo "║        Fake TLS | Защита от РКН / DPI / ТСПУ         ║"
    echo "╚══════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ─── Статус прокси (показывается в меню) ─────────────────────────────────────
print_status() {
    if docker ps --filter "name=$CONTAINER_NAME" --filter "status=running" 2>/dev/null | grep -q "$CONTAINER_NAME"; then
        echo -e "  Статус прокси: ${GREEN}${BOLD}● Запущен${NC}"
    elif docker ps -a --filter "name=$CONTAINER_NAME" 2>/dev/null | grep -q "$CONTAINER_NAME"; then
        echo -e "  Статус прокси: ${RED}${BOLD}● Остановлен${NC}"
    else
        echo -e "  Статус прокси: ${YELLOW}${BOLD}● Не установлен${NC}"
    fi

    if [[ -f "$STATE_FILE" ]]; then
        source "$STATE_FILE"
        echo -e "  Сервер: ${BOLD}${PUBLIC_IP:-?}:${PORT:-?}${NC}  |  Секрет: ${BOLD}${SECRET:-?}${NC}"
        [[ -n "${PROXY_TAG:-}" ]] && echo -e "  Proxy Tag: ${BOLD}$PROXY_TAG${NC}"
    fi
    echo ""
}

# ─── Главное меню ─────────────────────────────────────────────────────────────
main_menu() {
    while true; do
        print_banner
        print_status

        echo -e "  ${BOLD}Выберите действие:${NC}"
        echo ""
        echo -e "  ${GREEN}1)${NC} Установить / переустановить прокси"
        echo -e "  ${RED}2)${NC} Удалить прокси с сервера"
        echo -e "  ${CYAN}3)${NC} Показать данные для подключения"
        echo -e "  ${YELLOW}4)${NC} Показать логи прокси"
        echo -e "  0) Выход"
        echo ""
        read -rp "$(echo -e "  ${BOLD}Ваш выбор:${NC} ")" CHOICE

        case "$CHOICE" in
            1) action_install ;;
            2) action_remove ;;
            3) action_show_info ;;
            4) action_logs ;;
            0) echo ""; exit 0 ;;
            *) warn "Неверный выбор, попробуйте снова"; sleep 1 ;;
        esac
    done
}

# ═══════════════════════════════════════════════════════════════════════════════
#  ДЕЙСТВИЕ: УСТАНОВКА
# ═══════════════════════════════════════════════════════════════════════════════
action_install() {
    echo ""
    echo -e "${BOLD}=== Установка MTProto прокси ===${NC}"
    echo ""

    detect_os
    ask_install_params
    install_docker
    get_public_ip
    generate_secret
    configure_firewall
    start_proxy
    save_state
    check_connectivity
    print_result

    echo ""
    read -rp "Нажмите Enter для возврата в меню..."
}

# ─── Определение ОС ──────────────────────────────────────────────────────────
detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS_ID="${ID}"
    else
        error "Не удалось определить ОС"
    fi
    info "Система: $PRETTY_NAME"
}

# ─── Интерактивный ввод параметров установки ─────────────────────────────────
ask_install_params() {
    # Порт
    read -rp "$(echo -e "${CYAN}Порт для прокси${NC} [${DEFAULT_PORT}]: ")" INPUT_PORT
    PORT="${INPUT_PORT:-$DEFAULT_PORT}"
    if ! [[ "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1 || PORT > 65535 )); then
        error "Некорректный порт: $PORT"
    fi

    # Домен Fake TLS
    echo ""
    echo -e "  ${YELLOW}Совет по домену Fake TLS:${NC}"
    echo "  Домен должен быть популярным HTTPS-сайтом."
    echo "  Для VPS в РФ:   selectel.ru, timeweb.com, beget.com, vk.com"
    echo "  Для VPS вне РФ: www.microsoft.com, bing.com, yahoo.com"
    echo ""
    read -rp "$(echo -e "${CYAN}Домен для Fake TLS маскировки${NC} [${DEFAULT_CLOAK_DOMAIN}]: ")" INPUT_DOMAIN
    CLOAK_DOMAIN="${INPUT_DOMAIN:-$DEFAULT_CLOAK_DOMAIN}"

    # Proxy Tag (опционально)
    echo ""
    echo -e "  ${YELLOW}Proxy Tag (опционально):${NC}"
    echo "  Получите тег в @MTProxybot — отправьте боту IP:PORT, затем секрет."
    echo "  За каждого пользователя, купившего Premium через ваш прокси,"
    echo "  Telegram начисляет вам бесплатный Premium 🎁"
    echo "  Оставьте пустым если тега ещё нет — можно добавить позже."
    echo ""
    read -rp "$(echo -e "${CYAN}Proxy Tag${NC} [пропустить]: ")" INPUT_TAG
    PROXY_TAG="${INPUT_TAG:-}"

    echo ""
    info "Порт:           $PORT"
    info "Домен Fake TLS: $CLOAK_DOMAIN"
    [[ -n "$PROXY_TAG" ]] && info "Proxy Tag:      $PROXY_TAG" || info "Proxy Tag:      (не задан)"
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
            curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" \
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

    # Собираем аргументы динамически — тег добавляем только если задан
    DOCKER_ARGS=(
        run -d
        --name "$CONTAINER_NAME"
        --restart unless-stopped
        -p "${PORT}:${PORT}"
        nineseconds/mtg:2
        simple-run
        -n 1.1.1.1
        -i prefer-ipv4
    )

    [[ -n "${PROXY_TAG:-}" ]] && DOCKER_ARGS+=(-t "$PROXY_TAG")

    DOCKER_ARGS+=("0.0.0.0:${PORT}" "$SECRET")

    docker "${DOCKER_ARGS[@]}"

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
PROXY_TAG=${PROXY_TAG:-}
CONTAINER_NAME=$CONTAINER_NAME
INSTALLED_AT=$(date '+%Y-%m-%d %H:%M:%S')
EOF
    chmod 600 "$STATE_FILE"
    success "Конфигурация сохранена в $STATE_FILE"
}

# ─── Проверка подключения ─────────────────────────────────────────────────────
check_connectivity() {
    info "Проверяю доступность порта $PORT снаружи..."
    if command -v nc &>/dev/null; then
        if nc -z -w5 "$PUBLIC_IP" "$PORT" &>/dev/null; then
            success "Порт $PORT доступен снаружи ✓"
        else
            warn "Порт $PORT не отвечает снаружи."
            warn "Проверьте файрвол в панели управления хостингом (Security Groups / Firewall Rules)."
        fi
    fi
}

# ─── Вывод итоговых данных после установки ────────────────────────────────────
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
    [[ -n "${PROXY_TAG:-}" ]] && echo -e "  ${BOLD}Proxy Tag:${NC} $PROXY_TAG"
    echo ""
    echo -e "  ${BOLD}🔗 Ссылка для Telegram:${NC}"
    echo -e "  ${CYAN}$TG_URL${NC}"
    echo ""
    echo -e "  ${BOLD}🌐 Ссылка t.me (для публикации):${NC}"
    echo -e "  ${CYAN}$TME_URL${NC}"
    echo ""

    # Показываем инструкцию по MTProxybot только если тег ещё не задан
    if [[ -z "${PROXY_TAG:-}" ]]; then
        echo -e "  ${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "  ${BOLD}📌 Следующий шаг — получите Proxy Tag в @MTProxybot:${NC}"
        echo ""
        echo -e "  1. Откройте @MTProxybot в Telegram"
        echo -e "  2. Отправьте: ${BOLD}${PUBLIC_IP}:${PORT}${NC}"
        echo -e "  3. Отправьте секрет: ${BOLD}${SECRET}${NC}"
        echo -e "  4. Бот выдаст Proxy Tag — скопируйте его"
        echo -e "  5. Запустите скрипт снова → пункт 1 → вставьте тег"
        echo -e "     После этого Telegram будет начислять вам Premium 🎁"
        echo -e "  ${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
    fi

    echo -e "  ${YELLOW}⚠️  Совет по Fake TLS:${NC}"
    echo "  Если РКН начнёт блокировать ваш IP — смените домен маскировки."
    echo "  Запустите скрипт снова (пункт 1) и выберите другой домен."
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════
#  ДЕЙСТВИЕ: УДАЛЕНИЕ
# ═══════════════════════════════════════════════════════════════════════════════
action_remove() {
    echo ""
    echo -e "${RED}${BOLD}=== Удаление MTProto прокси ===${NC}"
    echo ""

    local CONTAINER_EXISTS=false
    local CONFIG_EXISTS=false
    docker ps -a --filter "name=$CONTAINER_NAME" 2>/dev/null | grep -q "$CONTAINER_NAME" && CONTAINER_EXISTS=true
    [[ -f "$STATE_FILE" ]] && CONFIG_EXISTS=true

    if ! $CONTAINER_EXISTS && ! $CONFIG_EXISTS; then
        warn "Прокси не установлен — нечего удалять."
        echo ""
        read -rp "Нажмите Enter для возврата в меню..."
        return
    fi

    echo -e "  Будет удалено:"
    $CONTAINER_EXISTS && echo -e "  ${RED}•${NC} Docker-контейнер: $CONTAINER_NAME"
    $CONFIG_EXISTS    && echo -e "  ${RED}•${NC} Файл конфигурации: $STATE_FILE"
    echo -e "  ${RED}•${NC} Docker-образ: nineseconds/mtg:2"
    echo ""
    echo -e "  ${YELLOW}Правило файрвола для порта НЕ удаляется автоматически.${NC}"
    echo ""

    read -rp "$(echo -e "  ${RED}${BOLD}Вы уверены? Введите 'yes' для подтверждения:${NC} ")" CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        info "Удаление отменено."
        echo ""
        read -rp "Нажмите Enter для возврата в меню..."
        return
    fi

    echo ""

    # Читаем порт до удаления конфига — нужен для подсказки по файрволу
    REMOVED_PORT=""
    $CONFIG_EXISTS && { source "$STATE_FILE" 2>/dev/null || true; REMOVED_PORT="${PORT:-}"; }

    # Останавливаем и удаляем контейнер
    if $CONTAINER_EXISTS; then
        info "Останавливаю контейнер..."
        docker stop "$CONTAINER_NAME" &>/dev/null && success "Контейнер остановлен"
        docker rm "$CONTAINER_NAME" &>/dev/null && success "Контейнер удалён"
    fi

    # Удаляем образ
    if docker images nineseconds/mtg:2 -q 2>/dev/null | grep -q .; then
        info "Удаляю Docker-образ nineseconds/mtg:2..."
        docker rmi nineseconds/mtg:2 &>/dev/null && success "Образ удалён"
    fi

    # Удаляем конфигурацию
    if $CONFIG_EXISTS; then
        info "Удаляю конфигурацию..."
        rm -f "$STATE_FILE"
        rmdir "$CONFIG_DIR" 2>/dev/null || true
        success "Конфигурация удалена"
    fi

    echo ""
    echo -e "${GREEN}${BOLD}✅ Прокси полностью удалён с сервера.${NC}"

    if [[ -n "${REMOVED_PORT:-}" ]]; then
        echo ""
        echo -e "  ${YELLOW}💡 Если нужно закрыть порт $REMOVED_PORT в файрволе:${NC}"
        echo -e "     ufw:       ${CYAN}ufw delete allow ${REMOVED_PORT}/tcp${NC}"
        echo -e "     firewalld: ${CYAN}firewall-cmd --permanent --remove-port=${REMOVED_PORT}/tcp && firewall-cmd --reload${NC}"
        echo -e "     iptables:  ${CYAN}iptables -D INPUT -p tcp --dport ${REMOVED_PORT} -j ACCEPT${NC}"
    fi

    echo ""
    read -rp "Нажмите Enter для возврата в меню..."
}

# ═══════════════════════════════════════════════════════════════════════════════
#  ДЕЙСТВИЕ: ПОКАЗАТЬ ДАННЫЕ
# ═══════════════════════════════════════════════════════════════════════════════
action_show_info() {
    echo ""
    if [[ ! -f "$STATE_FILE" ]]; then
        warn "Прокси не установлен. Сначала выполните установку (пункт 1)."
        echo ""
        read -rp "Нажмите Enter для возврата в меню..."
        return
    fi

    source "$STATE_FILE"

    TG_URL="tg://proxy?server=${PUBLIC_IP}&port=${PORT}&secret=${SECRET}"
    TME_URL="https://t.me/proxy?server=${PUBLIC_IP}&port=${PORT}&secret=${SECRET}"

    echo -e "${BOLD}=== Данные вашего прокси ===${NC}"
    echo ""
    echo -e "  ${BOLD}Сервер:${NC}      $PUBLIC_IP"
    echo -e "  ${BOLD}Порт:${NC}        $PORT"
    echo -e "  ${BOLD}Секрет:${NC}      $SECRET"
    echo -e "  ${BOLD}Fake TLS:${NC}    $CLOAK_DOMAIN"
    [[ -n "${PROXY_TAG:-}" ]] \
        && echo -e "  ${BOLD}Proxy Tag:${NC}   $PROXY_TAG" \
        || echo -e "  ${BOLD}Proxy Tag:${NC}   ${YELLOW}не задан${NC} (получите в @MTProxybot)"
    echo -e "  ${BOLD}Установлен:${NC}  ${INSTALLED_AT:-?}"
    echo ""
    echo -e "  ${BOLD}🔗 Ссылка для Telegram:${NC}"
    echo -e "  ${CYAN}$TG_URL${NC}"
    echo ""
    echo -e "  ${BOLD}🌐 Ссылка t.me:${NC}"
    echo -e "  ${CYAN}$TME_URL${NC}"
    echo ""

    if [[ -z "${PROXY_TAG:-}" ]]; then
        echo -e "  ${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "  ${BOLD}📌 Как получить Proxy Tag:${NC}"
        echo ""
        echo -e "  1. Откройте @MTProxybot в Telegram"
        echo -e "  2. Отправьте: ${BOLD}${PUBLIC_IP}:${PORT}${NC}"
        echo -e "  3. Отправьте секрет: ${BOLD}${SECRET}${NC}"
        echo -e "  4. Сохраните полученный тег"
        echo -e "  5. Пункт 1 меню → переустановка → введите тег"
        echo -e "  ${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
    fi

    read -rp "Нажмите Enter для возврата в меню..."
}

# ═══════════════════════════════════════════════════════════════════════════════
#  ДЕЙСТВИЕ: ЛОГИ
# ═══════════════════════════════════════════════════════════════════════════════
action_logs() {
    echo ""
    if ! docker ps -a --filter "name=$CONTAINER_NAME" 2>/dev/null | grep -q "$CONTAINER_NAME"; then
        warn "Контейнер не найден. Сначала установите прокси (пункт 1)."
        echo ""
        read -rp "Нажмите Enter для возврата в меню..."
        return
    fi

    echo -e "${BOLD}=== Логи прокси (последние 50 строк) ===${NC}"
    echo -e "${YELLOW}Ctrl+C для выхода из логов${NC}"
    echo ""
    docker logs -f --tail 50 "$CONTAINER_NAME" || true
    echo ""
    read -rp "Нажмите Enter для возврата в меню..."
}

# ─── Точка входа ─────────────────────────────────────────────────────────────
main_menu
