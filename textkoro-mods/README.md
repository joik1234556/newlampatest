# Easy-mods & Balancer-Mods (LAMPA plugins + backend)

Проект состоит из:
- `plugin/easy-mods.js` — плагин потоковой передачи через TorrServer (torrent-стриминг)
- `plugin/koro-mods.js` — утилитарный плагин для управления источниками
- `plugin/balancer-mods.js` — плагин прямой интеграции онлайн-балансеров (HDRezka, Zetflix, Alloha, VideoCDN, Kodik, Ashdi, Filmix)
- `backend/` — Node.js + Express API: поиск через Jackett/TorrServer и прокси для балансеров

---

## balancer-mods.js — онлайн-балансеры

### Поддерживаемые источники

| Балансер   | Качество             | Озвучки | Сезоны/серии | Примечание         |
|------------|----------------------|---------|---------------|--------------------|
| HDRezka    | 4K, 1080p, 720p, …   | ✅       | ✅             | Обязательный       |
| Zetflix    | 4K, 1080p            | —       | ✅             | Netflix-контент    |
| Alloha     | 4K HDR, 1080p        | —       | —             | Лучший для 4K      |
| VideoCDN   | 1080p, 720p          | —       | ✅             | Стабильный 1080p   |
| Kodik      | 1080p, 720p          | ✅       | ✅             | Сериалы и аниме    |
| Ashdi      | 1080p, 720p          | —       | ✅             | Украинская озвучка |
| Filmix     | 4K, 1080p            | ✅       | ✅             | Требует токен (VIP)|

### Возможности

- Поиск по `kinopoisk_id` / `tmdb_id` / `imdb_id` / названию
- Выбор качества: результаты сгруппированы от 4K вниз до 360p
- Выбор озвучки (HDRezka, Kodik, Filmix)
- Навигация по сезонам и сериям для сериалов
- Кэширование результатов на 12 минут
- Обработка «битых» ссылок (404/502 скрыты из списка)
- Управление включением/выключением каждого балансера в настройках

### Настройки плагина в LAMPA

| Параметр | Описание |
|----------|----------|
| `Balancer-Mods: Proxy URL` | URL бэкенд-прокси, например `https://mods.example.com/api/balancers` |
| `Balancer-Mods: Filmix токен` | Токен пользователя Filmix (для доступа к 4K) |
| `Balancer-Mods: Управление источниками` | Включить / отключить отдельные балансеры |

---

## easy-mods.js — TorrServer стриминг

1. Показывает источники в «Онлайн»: VeoVeo, ViDEX, ManGo (VIP), FXpro (VIP), FlixSOD (VIP), Alloha (VIP), Easy-mods, HDRezka (VIP), HDVB (VIP).
2. По источнику **Easy-mods** выполняется запрос на ваш backend `/search`.
3. Backend возвращает список потоков (качество/озвучка/сиды/размер).
4. Пользователь выбирает вариант.
5. Плагин открывает `streamUrl` в плеере LAMPA (m3u8/stream URL).

---

## Backend API

- `GET /health`
- `GET /sources?isVip=true|false`
- `POST /search` — поиск через Jackett
- `POST /stream` — принять magnet, вернуть playlist URL
- `GET /stream?magnet=...` — быстрый GET-вариант
- `GET /api/balancers/list` — список настроенных балансеров
- `GET /api/balancers/search?balancer=kodik&kp_id=12345&type=movie` — поиск через прокси-балансер

---

## Рекомендуемая инфраструктура

- 4–8 vCPU, 16–32 GB RAM, NVMe SSD, 1 Gbit/s
- Cloudflare (желательно Spectrum / TCP proxy)


## Подключение плагинов без 404

### Почему возникает 404?

GitHub Pages отдаёт только файлы из папки `docs/` (или корня) ветки, которая настроена в **Settings → Pages**. Если файл лежит глубоко (`textkoro-mods/plugin/`), он не будет найден по короткому URL.

Файлы в папке `docs/` этого репозитория специально размещены для GitHub Pages:

| Плагин | GitHub Pages URL (после включения Pages) |
|--------|------------------------------------------|
| balancer-mods | `https://joik1234556.github.io/newlampatest/balancer-mods.js` |
| easy-mods | `https://joik1234556.github.io/newlampatest/easy-mods.js` |
| koro-mods | `https://joik1234556.github.io/newlampatest/koro-mods.js` |

### Как включить GitHub Pages

1. Откройте **Settings** → **Pages** в репозитории `joik1234556/newlampatest`
2. В поле **Source** выберите ветку `main` и папку `/docs`
3. Нажмите **Save**
4. Через 1–2 минуты файлы будут доступны по URL выше

### Альтернативный URL (без GitHub Pages, всегда работает)

```
https://raw.githubusercontent.com/joik1234556/newlampatest/main/docs/balancer-mods.js
https://raw.githubusercontent.com/joik1234556/newlampatest/main/docs/easy-mods.js
```

> ❌ Не использовать: `https://github.com/joik1234556/newlampatest/blob/main/docs/balancer-mods.js` — это HTML-страница, а не JS-файл.
