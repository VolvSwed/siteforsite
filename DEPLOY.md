# Запуск VYRAZ.BY на обычном хостинге

Проект запускается как стандартное Node.js-приложение. Требования: Node.js 20+, npm и постоянная директория, доступная для записи SQLite-базы.

## Вариант 1 — хостинг с панелью управления

В cPanel, ISPmanager или похожей панели найдите создание Node.js-приложения и укажите:

- версия Node.js: `20` или новее;
- корневая директория: папка репозитория;
- команда запуска: `npm start`;
- startup-файл, если панель требует его отдельно: `src/server.js`;
- порт: значение, которое панель передаёт в переменной `PORT`.

Загрузите проект, откройте его терминал и выполните:

```bash
npm ci --omit=dev
cp .env.example .env
```

Настройте переменные окружения через панель или файл `.env`:

```env
ADMIN_PASSWORD=очень-длинный-уникальный-пароль
PORT=3000
HOST=0.0.0.0
PUBLIC_ORIGIN=https://vyraz.by
TRUST_PROXY=1
DATA_FILE=/полный/путь/к/постоянной/папке/vyraz.sqlite
```

Перезапустите приложение в панели. SQLite-схема и файл базы создадутся автоматически.

## Вариант 2 — VPS с Ubuntu и Nginx

```bash
git clone https://github.com/VolvSwed/siteforsite.git
cd siteforsite
npm ci --omit=dev
cp .env.example .env
nano .env
```

Для постоянной работы создайте `/etc/systemd/system/vyraz.service`:

```ini
[Unit]
Description=VYRAZ website
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/siteforsite
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Путь `WorkingDirectory` замените на реальное расположение проекта. Затем:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vyraz
sudo systemctl status vyraz
```

Конфигурация Nginx:

```nginx
server {
    listen 80;
    server_name vyraz.by www.vyraz.by;

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

После проверки подключите HTTPS через сертификат хостинга или Certbot.

## Обновление

```bash
git pull
npm ci --omit=dev
sudo systemctl restart vyraz
```

## База и резервные копии

По умолчанию база хранится в `data/vyraz.sqlite`. Для production лучше задать абсолютный `DATA_FILE` в постоянной директории и ежедневно сохранять копии файлов SQLite. Не размещайте базу внутри `public/`.

Перед приёмом реальных заявок добавьте финальную политику обработки персональных данных и реквизиты владельца сайта.
