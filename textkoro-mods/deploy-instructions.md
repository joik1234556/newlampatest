# Deploy-инструкция

## 1) Backend (VPS)

### Установка

```bash
sudo apt update && sudo apt install -y nodejs npm
node -v
npm -v
```

### Запуск

```bash
cd textkoro-mods/backend
npm install
npm start
```

Сервер поднимется на порту `3000` (или `PORT` из env).

### Пример с PM2

```bash
sudo npm i -g pm2
cd textkoro-mods/backend
pm2 start server.js --name easy-mods-backend
pm2 save
pm2 startup
```

### Пример Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Проверьте:

```bash
curl http://your-domain.com/api/health
curl "http://your-domain.com/api/sources"
curl -X POST http://your-domain.com/api/check-vip \
  -H 'Content-Type: application/json' \
  -d '{"key":"EASYMODS-TRIAL-2026"}'
```

---

## 2) Плагин (GitHub Pages)

1. Создайте репозиторий на GitHub.
2. Поместите `plugin/koro-mods.js` в репозиторий.
3. Включите GitHub Pages (ветка `main`, папка `/root`).
4. Получите прямой URL:
   - `https://<username>.github.io/<repo>/koro-mods.js`

### Подключение в LAMPA

1. Откройте в LAMPA «Плагины» → «Добавить по ссылке».
2. Вставьте URL `koro-mods.js`.
3. Перезапустите LAMPA или обновите плагины.
4. В настройках плагина укажите:
   - `Easy-Mods: API URL` = `https://your-domain.com/api`
   - `Easy-Mods: VIP ключ` = ваш ключ (опционально)

---

## 3) Добавление/удаление источников

Редактируйте `backend/sources.json`:

```json
{
  "id": "new-source",
  "name": "New Source",
  "icon": "🆕",
  "vip": true,
  "quality": "4K HDR",
  "description": "Описание",
  "balancer": "https://new-source.example"
}
```

После сохранения файла новый источник начнет отдаваться API автоматически.

---

## 4) Добавление VIP ключей

Редактируйте `backend/vip-keys.json`:

```json
{
  "key": "MY-NEW-VIP-KEY",
  "label": "paid-user",
  "active": true,
  "expiresAt": "2026-12-31T23:59:59.000Z"
}
```

- `active: false` — ключ выключен
- `expiresAt: null` — бессрочный ключ
