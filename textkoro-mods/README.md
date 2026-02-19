# Easy-mods (LAMPA plugin + backend streaming)

Проект состоит из:
- `plugin/easy-mods.js` — единый плагин для LAMPA 1.12+
- `backend/` — Node.js + Express API, который делает поиск и выдает stream URL через TorrServer

## Что делает Easy-mods

1. Показывает источники в «Онлайн»: VeoVeo, ViDEX, ManGo (VIP), FXpro (VIP), FlixSOD (VIP), Alloha (VIP), Easy-mods, HDRezka (VIP), HDVB (VIP).
2. По источнику **Easy-mods** выполняется запрос на ваш backend `/search`.
3. Backend возвращает список потоков (качество/озвучка/сиды/размер).
4. Пользователь выбирает вариант.
5. Плагин открывает `streamUrl` в плеере LAMPA (m3u8/stream URL).

## Backend API

- `GET /health`
- `GET /sources?isVip=true|false`
- `POST /search` — поиск через Jackett/сервер
- `POST /stream` — принять magnet, выбрать TorrServer и вернуть playlist URL
- `GET /stream?magnet=...` — быстрый вариант без POST

## Рекомендуемая инфраструктура для старта (до ~10 зрителей 4K)

- 4–8 vCPU
- 16–32 GB RAM
- NVMe SSD
- 1 Gbit/s uplink
- Cloudflare (желательно Spectrum / TCP proxy для stream узлов)
