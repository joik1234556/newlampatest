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

## 4) Подключение easy-mods.js в LAMPA

1. Загрузите `plugin/easy-mods.js` в GitHub-репозиторий.
2. Включите GitHub Pages.
3. Используйте **прямую ссылку на JS-файл**:
   - GitHub Pages: `https://<username>.github.io/<repo>/easy-mods.js`
   - или RAW: `https://raw.githubusercontent.com/<username>/<repo>/main/textkoro-mods/plugin/easy-mods.js`

⚠️ Важно: ссылка вида `https://github.com/<user>/<repo>/.../easy-mods.js` (страница сайта GitHub) не подходит и в LAMPA даёт `404`.

4. В LAMPA: Плагины → Добавить по ссылке → вставить прямой URL.

## 5) Настройка плагина в LAMPA

В настройках плагина заполните:
- `Easy-mods: Мой сервер` → `https://mods.example.com`
- `Easy-mods: Jackett URL (опционально)`
- `Easy-mods: Jackett API Key (опционально)`
- `Easy-mods: Я VIP` → если нужен доступ к VIP-источникам
- `Easy-mods: Вкл/выкл источники`

## 6) Как получить Jackett API Key

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
