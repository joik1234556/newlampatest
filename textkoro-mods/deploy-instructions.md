# Deploy: Easy-mods backend + plugin

## 1) Запуск backend на VPS

```bash
cd textkoro-mods/backend
npm install
npm start
```

Проверка:

```bash
curl http://127.0.0.1:3000/health
curl "http://127.0.0.1:3000/sources?isVip=false"
curl -X POST http://127.0.0.1:3000/search \
  -H 'Content-Type: application/json' \
  -d '{"title":"Dune","year":2021,"jackettUrl":"http://127.0.0.1:9117","jackettKey":"YOUR_KEY"}'
```

## 2) Docker stack (backend + jackett + 2 TorrServer)

```bash
cd textkoro-mods/backend
docker compose up -d --build
```

Перед запуском обязательно задайте:
- `JACKETT_KEY`
- `STREAM_PUBLIC_BASE`

в `docker-compose.yml`.

## 3) Настройка Nginx (пример)

```nginx
server {
    listen 443 ssl http2;
    server_name mods.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 4) Подключение плагинов в LAMPA (без ошибки 404)

### Почему возникает 404?

Когда вы добавляете в LAMPA URL вида `https://github.com/joik1234556/newlampatest/blob/main/textkoro-mods/plugin/balancer-mods.js` — это HTML-страница GitHub, а не JS-файл. LAMPA получает HTML вместо JavaScript и показывает ошибку.

Файлы плагинов находятся в папке **`docs/`** в корне репозитория специально для GitHub Pages:

```
docs/balancer-mods.js
docs/easy-mods.js
docs/koro-mods.js
```

### Шаг 1 — Включите GitHub Pages

1. Откройте репозиторий `joik1234556/newlampatest` → **Settings** → **Pages**
2. В поле **Source** выберите:
   - Branch: `main`
   - Folder: `/docs`
3. Нажмите **Save**
4. Подождите 1–2 минуты

### Шаг 2 — Добавьте в LAMPA

Используйте один из этих URL (оба работают без 404):

**GitHub Pages (рекомендуется):**
```
https://joik1234556.github.io/newlampatest/balancer-mods.js
https://joik1234556.github.io/newlampatest/easy-mods.js
```

**RAW GitHub (работает сразу, без включения Pages):**
```
https://raw.githubusercontent.com/joik1234556/newlampatest/main/docs/balancer-mods.js
https://raw.githubusercontent.com/joik1234556/newlampatest/main/docs/easy-mods.js
```

В LAMPA: **Плагины → Добавить по ссылке** → вставить один из URL выше.

⚠️ Не использовать URL вида `https://github.com/...blob.../balancer-mods.js` — это HTML-страница, даёт 404/ошибку в LAMPA.

## 5) Настройка balancer-mods.js в LAMPA
3. В настройках плагина заполните:
   - `Balancer-Mods: Proxy URL` → `https://mods.example.com/api/balancers`
   - `Balancer-Mods: Filmix токен` → ваш Filmix-токен (опционально)
   - `Balancer-Mods: Управление источниками` → включить/отключить балансеры

## 6) Переменные окружения для балансеров

Задайте токены API нужных балансеров в `docker-compose.yml` или как env vars сервера:

```env
KODIK_TOKEN=ваш_kodik_token
VIDEOCDN_TOKEN=ваш_videocdn_token
ALLOHA_TOKEN=ваш_alloha_token
ZETFLIX_TOKEN=ваш_zetflix_token
ASHDI_TOKEN=ваш_ashdi_token
FILMIX_TOKEN=ваш_filmix_token
FILMIX_DEV_ID=ваш_filmix_dev_id
# HDRezka работает без токена (парсинг HTML)
```

Проверка балансеров:
```bash
curl "http://127.0.0.1:3000/api/balancers/list"
curl "http://127.0.0.1:3000/api/balancers/search?balancer=kodik&kp_id=12345&type=movie"
```

## 7) Настройка easy-mods.js в LAMPA

В настройках плагина заполните:
- `Easy-mods: Мой сервер` → `https://mods.example.com`
- `Easy-mods: Jackett URL (опционально)`
- `Easy-mods: Jackett API Key (опционально)`
- `Easy-mods: Я VIP` → если нужен доступ к VIP-источникам
- `Easy-mods: Вкл/выкл источники`

## 8) Как получить Jackett API Key

1. Откройте Jackett Web UI.
2. На Dashboard найдите поле API Key.
3. Скопируйте ключ и вставьте в настройки плагина либо в `JACKETT_KEY` backend.
4. Добавьте indexers (минимум 3-5), ориентированные на ваши языки/качество.

## 7) План масштабирования (1–3 месяца)

### Этап 0 → 10 зрителей
- 1 backend + 2 TorrServer инстанса.
- In-memory cache + базовый rate-limit (уже есть в коде).
- Логи запросов и ручной мониторинг CPU/RAM/IO.

### Этап 10 → 30 зрителей
- Вынос кэша в Redis.
- 3–4 TorrServer инстанса за L4/L7 балансировщиком.
- Отдельный сервер для Jackett/парсеров.
- Автоматический health-check TorrServer узлов.

### Этап 30 → 100 зрителей
- Несколько backend-реплик за reverse proxy (Nginx/Traefik).
- Redis + очередь задач (BullMQ/RabbitMQ) для тяжелых операций.
- Гео-распределение stream-узлов, CDN/Cloudflare Spectrum.
- Метрики Prometheus + Grafana + алерты (CPU, RAM, saturation, 5xx).
