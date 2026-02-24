# Lampa Backend

Минимальный FastAPI-бэкенд, который работает как промежуточный слой между Lampa-плагином и источниками **Kinogo** / **Rezka** / **TorBox** (Easy Mod).

## Требования

- Python 3.11+
- TorBox API-ключ

## Установка

```bash
git clone <repo>
cd newlampatest

# создать виртуальное окружение
python -m venv .venv
source .venv/bin/activate

# установить зависимости
pip install -r requirements.txt

# скопировать .env.example → .env и вписать ключ TorBox
cp .env.example .env
nano .env
```

## Запуск

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Swagger UI доступен по адресу: `http://<SERVER_IP>:8000/docs`

## Эндпоинты

| Method | Path | Описание |
|--------|------|----------|
| `GET` | `/health` | Статус сервиса + проверка TorBox |
| `GET` | `/search?q=<строка>` | Параллельный поиск по зеркалам Kinogo и Rezka |
| `GET` | `/get?url=<url>&source=kinogo\|rezka` | Парсинг страницы фильма → файлы/плеер |
| `GET` | `/easy/direct?magnet=<magnet>` | Добавить magnet в TorBox → прямая ссылка |
| `GET` | `/easy/direct?torrent_id=<id>&file_idx=<n>` | Получить прямую ссылку по torrent_id |

### Rate limiting

60 запросов в минуту с одного IP на `/search`, `/get`, `/easy/direct`.

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `TORBOX_API_KEY` | Ваш TorBox API-ключ |

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

Получить сертификат: `certbot --nginx -d your.domain`
