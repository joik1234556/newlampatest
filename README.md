# Lampa Easy-Mod Backend

Бэкенд-сервис для медиаплеера **Lampa**: находит торренты через Torrentio / Jackett, загружает их в TorBox и отдаёт плееру прямую HTTPS-ссылку.

---

## 🚀 Быстрый старт с нуля (Docker, рекомендуется)

### Шаг 1 — Установить Docker и Docker Compose

```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker          # применить группу без перелогина
```

> Проверьте: `docker --version && docker compose version`

---

### Шаг 2 — Склонировать репозиторий

```bash
git clone https://github.com/joik1234556/newlampatest.git
cd newlampatest
```

---

### Шаг 3 — Создать файл `.env`

```bash
cp .env.example .env
```

Откройте `.env` и укажите свой ключ TorBox:

```bash
nano .env          # или любой другой редактор
```

Найдите строку и замените значение:

```
TORBOX_API_KEY=your-torbox-api-key-here
```

> Получить ключ: [torbox.app](https://torbox.app) → настройки аккаунта → API.

---

### Шаг 4 — Запустить весь стек

```bash
docker compose up -d
```

Docker скачает образы и запустит три контейнера:
| Сервис | Адрес | Описание |
|---|---|---|
| backend | http://&lt;ip&gt;:8000 | FastAPI-сервер |
| jackett | http://&lt;ip&gt;:9117 | Менеджер трекеров |
| redis | localhost:6379 | Кеш (внутренний) |

Проверьте, что всё запустилось:

```bash
docker compose ps
curl http://localhost:8000/health
```

---

### Шаг 5 — Настроить Jackett (один раз)

1. Откройте в браузере `http://<ip-сервера>:9117`
2. Нажмите **+ Add indexer** и добавьте нужные трекеры (rutracker, kinozal, nnmclub и т.д.)
3. Скопируйте **API Key** из правого верхнего угла Jackett
4. Вставьте ключ в `.env`:
   ```
   JACKETT_API_KEY=<ваш-ключ>
   ```
5. Перезапустите бэкенд:
   ```bash
   docker compose restart backend
   ```

---

### Шаг 6 — Подключить плагин в Lampa

1. В Lampa: **Настройки → Плагины → Добавить плагин**
2. Введите URL:
   ```
   http://<ip-сервера>:8000/static/easy-mod.js
   ```
3. Сохраните и перезагрузите Lampa.

---

## 🔄 Обновление на сервере

```bash
cd newlampatest
./update.sh                  # обычное обновление (Redis и Jackett не трогаются)
./update.sh --no-cache       # если изменились requirements.txt / Dockerfile
./update.sh --full           # полный перезапуск стека (сбрасывает Redis-кеш)
```

---

## 🛠 Полезные команды

```bash
# Логи в реальном времени
docker compose logs -f backend

# Перезапустить после изменения .env
docker compose restart backend

# Статус контейнеров
docker compose ps

# Остановить всё
docker compose down
```

---

## 🏃 Запуск без Docker (локальная разработка)

Требуется Python 3.11+ и запущенный Redis.

```bash
# Запустить Redis (если не запущен)
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Создать .env (если ещё нет)
cp .env.example .env

# Запустить бэкенд
chmod +x run.sh
./run.sh                   # 4 воркера
./run.sh --reload          # режим горячей перезагрузки (разработка)
```

---

## 🌐 Эндпоинты

| Метод | URL | Описание |
|---|---|---|
| GET | `/health` | Статус сервера + TorBox |
| GET | `/variants?title=...&tmdb_id=...` | Список вариантов воспроизведения |
| POST | `/stream/start` | Создать задачу стриминга |
| GET | `/stream/status?job_id=...` | Статус задачи (→ direct_url) |
| GET | `/static/easy-mod.js` | Плагин для Lampa |
| GET | `/docs` | Swagger UI |

---

## ⚙️ Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `TORBOX_API_KEY` | **обязательно** | Ключ TorBox API |
| `REDIS_URL` | `redis://localhost:6379/0` | URL Redis |
| `JACKETT_URL` | — | URL Jackett (авто в Compose) |
| `JACKETT_API_KEY` | — | Ключ Jackett (после настройки) |
| `LOG_LEVEL` | `INFO` | Уровень логирования |
| `VARIANTS_CACHE_TTL` | `1800` | TTL кеша вариантов (сек) |

Полный список переменных — в `.env.example` и `GUIDE.txt`.

---

## 🔍 Устранение неполадок

**`/variants` возвращает пустой список**
- Передайте `tmdb_id` — без него Torrentio не работает.
- Настройте Jackett и добавьте трекеры.
- Проверьте логи: `docker compose logs -f backend`

**`/stream/start` возвращает `state="failed"`**
- Проверьте `TORBOX_API_KEY` в `.env`.
- Убедитесь, что magnet-ссылка рабочая.
- Увеличьте `TORBOX_POLL_MAX_SECONDS=300`.

**Redis connection error**
- Не критично — сервер переключится на in-memory кеш.
- При использовании Docker Compose Redis запускается автоматически.

---

Подробное руководство разработчика — в файле **GUIDE.txt**.
