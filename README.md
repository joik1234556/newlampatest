# Lampa Backend v2.0

Минимальный FastAPI-бэкенд, работающий как промежуточный слой между Lampa-плагином и источниками **Kinogo** / **Rezka** / **TorBox** (Easy Mod).

## Требования

- Python 3.11+
- TorBox API-ключ

## Установка

```bash
git clone <repo>
cd newlampatest

# виртуальное окружение
python -m venv .venv
source .venv/bin/activate

# зависимости
pip install -r requirements.txt

# скопировать .env.example → .env и вписать ключ TorBox
cp .env.example .env
nano .env
```

## Запуск

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Swagger UI: `http://<SERVER_IP>:8000/docs`

---

## Эндпоинты

### Основные

| Method | Path | Описание |
|--------|------|----------|
| `GET` | `/health` | Статус сервиса + проверка TorBox |
| `GET` | `/search?q=<строка>` | Параллельный поиск по зеркалам Kinogo и Rezka |
| `GET` | `/get?url=<url>&source=kinogo\|rezka` | Парсинг страницы фильма → файлы/плеер |
| `GET` | `/easy/direct?magnet=<magnet>` | Добавить magnet в TorBox → прямая ссылка |
| `GET` | `/easy/direct?torrent_id=<id>&file_idx=<n>` | Получить прямую ссылку по torrent_id |

### TorBox (основной поток для плагина v2.0)

| Method | Path | Описание |
|--------|------|----------|
| `GET` | `/torbox/search?q=<название>` | Поиск торрент-вариантов (Jackett в разработке) |
| `GET` | `/torbox/get?magnet=<magnet>` | Добавить magnet → ждать готовности (до 4 мин) → вернуть прямые ссылки |

#### `/torbox/search` — ответ
```json
{
  "results": [],
  "message": "Поиск торрентов временно недоступен (Jackett в разработке)...",
  "query": "Дюна 2"
}
```

#### `/torbox/get` — ответ (готово)
```json
{
  "status": "ready",
  "files": [
    { "title": "film.1080p.mkv", "quality": "1080p", "url": "https://cdn.torbox.app/...", "size": 8589934592 }
  ],
  "torrent_id": "42"
}
```

#### `/torbox/get` — ответ (ещё загружается)
```json
{
  "status": "processing",
  "files": [],
  "torrent_id": "42",
  "message": "Торрент ещё загружается..."
}
```

### Статика (плагин)

```
GET /static/koroT_final.js
```

---

## Плагин Lampa (koroT_final.js)

### Как установить

1. В Lampa открыть **Настройки → Плагины → Добавить плагин**
2. Вставить URL: `http://<SERVER_IP>:8000/static/koroT_final.js`
3. Сохранить и перезапустить Lampa

### Пользовательский сценарий

```
Открыть фильм → «Смотреть» 
→ Нажать «TorBox» (новая кнопка рядом с «Смотреть»)
→ Если поиск вернул результаты — выбрать вариант
→ Если нет — ввести magnet-ссылку вручную
→ Ждать готовности (до 4 минут) 
→ Выбрать качество из списка
→ Фильм запускается напрямую (HTTPS от TorBox)
```

### Rate limiting

60 запросов в минуту с одного IP на все эндпоинты.

---

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `TORBOX_API_KEY` | Ваш TorBox API-ключ |

---

## Производство (nginx + SSL)

```nginx
server {
    listen 443 ssl;
    server_name your.domain;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Сертификат: `certbot --nginx -d your.domain`
