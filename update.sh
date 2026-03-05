#!/usr/bin/env bash
# update.sh — обновление Lampa Easy-Mod на сервере (без лишней остановки сервисов)
#
# Использование:
#   ./update.sh              # обычное обновление (с кешем слоёв Docker)
#   ./update.sh --no-cache   # полная пересборка (нужна при изменении requirements.txt)
#   ./update.sh --full       # полное пересоздание стека (очищает Redis-кеш)
#
# Требования: Docker + Docker Compose, git
#
# Подробное описание шагов — GUIDE.txt, раздел 14.

set -euo pipefail

BRANCH="${UPDATE_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'copilot/connect-plugin-to-backend')}"
COMPOSE="docker compose"
BUILD_FLAGS=""
FULL_RESTART=false

# ── разбор аргументов ────────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --no-cache) BUILD_FLAGS="--no-cache" ;;
        --full)     FULL_RESTART=true ;;
        -h|--help)
            echo "Использование: ./update.sh [--no-cache] [--full]"
            echo "  (без флагов) — обычное обновление, Redis/Jackett не трогаются"
            echo "  --no-cache   — принудительно пересобрать без кеша Docker-слоёв"
            echo "  --full       — полное пересоздание всего стека (сбрасывает кеш Redis)"
            exit 0
            ;;
        *) echo "[update.sh] Неизвестный аргумент: $arg  (используйте --help)" >&2; exit 1 ;;
    esac
done

echo "════════════════════════════════════════════════════════════"
echo "  Lampa Easy-Mod — обновление проекта"
echo "  Ветка: $BRANCH"
echo "════════════════════════════════════════════════════════════"

# ── 1. Git: сохранить правки, получить новый код ─────────────────────────────
echo ""
echo "▶ [1/4] Обновление исходного кода..."

# Сохранить локальные правки (если есть), чтобы pull прошёл без конфликтов
STASH_MSG="update.sh auto-stash $(date '+%Y-%m-%d %H:%M:%S')"
if git diff --quiet && git diff --cached --quiet; then
    HAS_STASH=false
else
    echo "    Есть локальные изменения — сохраняем в stash..."
    git stash push -u -m "$STASH_MSG"
    HAS_STASH=true
fi

git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if $HAS_STASH; then
    echo "    Возвращаем локальные изменения из stash..."
    git stash pop || {
        echo "⚠  Конфликт при git stash pop."
        echo "   Разрешите конфликты вручную, затем выполните: git stash drop"
        echo "   Список stash-ов: git stash list"
    }
fi

echo "    ✓ Код обновлён."

# ── 2. Пересборка образа бэкенда ─────────────────────────────────────────────
echo ""
echo "▶ [2/4] Сборка образа бэкенда..."

if $FULL_RESTART; then
    # Полная пересборка всех сервисов (сбросит Redis-кеш при down)
    echo "    Режим: полное пересоздание стека (--full)"
    $COMPOSE down
    # shellcheck disable=SC2086
    $COMPOSE build $BUILD_FLAGS
else
    # Только образ бэкенда; Redis и Jackett продолжают работать
    # shellcheck disable=SC2086
    $COMPOSE build $BUILD_FLAGS backend
fi

echo "    ✓ Образ собран."

# ── 3. Запуск / перезапуск контейнеров ──────────────────────────────────────
echo ""
echo "▶ [3/4] Запуск контейнеров..."

if $FULL_RESTART; then
    $COMPOSE up -d
else
    # --no-deps — не пересоздавать Redis и Jackett
    $COMPOSE up -d --no-deps backend
fi

echo "    ✓ Контейнеры запущены."

# ── 4. Проверка состояния ────────────────────────────────────────────────────
echo ""
echo "▶ [4/4] Проверка состояния..."

# Даём бэкенду 5 секунд подняться
sleep 5

$COMPOSE ps

# Быстрая проверка /health (не прерываем скрипт если бэкенд ещё стартует)
if command -v curl &>/dev/null; then
    echo ""
    echo "    Проверка /health ..."
    curl -sf --max-time 5 http://localhost:8000/health && echo "" || \
        echo "    ⚠  /health не ответил — проверьте логи: docker compose logs -f backend"
fi

SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
SERVER_IP="${SERVER_IP:-localhost}"
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✅ Обновление завершено!"
echo ""
echo "  Плагин:  http://${SERVER_IP}:8000/static/easy-mod.js"
echo "  Jackett: http://${SERVER_IP}:9117"
echo ""
echo "  Просмотр логов: docker compose logs -f backend"
echo "════════════════════════════════════════════════════════════"
