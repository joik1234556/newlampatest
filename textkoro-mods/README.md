# Easy-Mods (аналог modss.tv для LAMPA)

Полный комплект:
- `backend/` — Node.js + Express API для динамической выдачи онлайн-источников и проверки VIP.
- `plugin/koro-mods.js` — один файл плагина для LAMPA 1.12+.

## Быстрый старт

1. Настройте и запустите backend (см. `deploy-instructions.md`).
2. Откройте `plugin/koro-mods.js` и задайте `DEFAULT_API` на ваш URL API.
3. Загрузите `koro-mods.js` на GitHub Pages.
4. Добавьте ссылку на плагин в LAMPA.

## Динамические источники

- Источники хранятся в `backend/sources.json`.
- API всегда читает файл при запросе, поэтому изменения применяются без перезапуска.
- Бесплатные пользователи получают только `vip: false` источники.
- VIP-пользователи получают весь список.

## VIP-ключи

- Ключи хранятся в `backend/vip-keys.json`.
- Проверка ключа:
  - `POST /api/check-vip`
- Получение источников с VIP:
  - `GET /api/sources?vipKey=ВАШ_КЛЮЧ`

## Рекомендуемая структура

```text
textkoro-mods/
├── backend/
│   ├── server.js
│   ├── config.js
│   ├── sources.json
│   ├── vip-keys.json
│   ├── package.json
│   └── routes/
│       └── api.js
├── plugin/
│   └── koro-mods.js
├── README.md
└── deploy-instructions.md
```
