# Развёртывание Family OS на ThinkPad (домашний сервер)

## 0. Перед началом

1. Прочитайте `docs/KNOWN_LIMITATIONS.md` — там честно написано, что уже проверено, а что
   нет.
2. Убедитесь, что на ThinkPad есть Docker и docker compose (если ещё не установлены —
   `sudo apt install docker.io docker-compose-plugin`).
3. Место на диске: контейнеры + Postgres + файловое хранилище — начните с минимум 10 ГБ
   свободных на `nvme1n1` (`/mnt/storage`), не на `nvme0n1` (там уже `root + /srv/backups`).

## 1. Разместить проект

```bash
sudo mkdir -p /opt/family-os
sudo chown $USER:$USER /opt/family-os
git clone <URL вашего репозитория> /opt/family-os
cd /opt/family-os
```

Если репозитория ещё нет — просто скопируйте архив с кодом в `/opt/family-os`.

## 2. Настроить .env

```bash
cp .env.production.example .env
openssl rand -hex 24   # → POSTGRES_PASSWORD
openssl rand -hex 32   # → JWT_ACCESS_SECRET
openssl rand -hex 32   # → JWT_REFRESH_SECRET
openssl rand -hex 32   # → TWO_FACTOR_ENC_KEY
nano .env               # вставить сгенерированные значения
```

**Важно:** `TWO_FACTOR_ENC_KEY` — сохраните резервную копию отдельно (например, в Bitwarden/
KeePass, как и предполагает раздел 27 концепции проекта про менеджеры секретов). Потеря этого
ключа = все пользователи теряют доступ к 2FA.

## 3. Собрать и запустить

```bash
docker compose up -d --build
docker compose ps                 # все сервисы должны быть healthy через ~30-60 сек
docker compose exec api npx prisma migrate deploy
docker compose exec api npx prisma db seed   # опционально — демо-данные для проверки
```

Проверка:
```bash
curl http://127.0.0.1:3401/health     # backend
curl -I http://192.168.1.18:3400      # frontend, из LAN
```

## 4. Открыть порт в firewall (аналогично уже настроенным сервисам)

Добавить в таблицу ufw (см. проектную заметку про сервер) — по аналогии с портом 3300
(Grafana) и 3000 (AdGuard):

```bash
sudo ufw allow from 192.168.1.0/24 to any port 3400 proto tcp comment 'Family OS web'
```

Порт backend (3401) **не открывать** наружу — он только на loopback, frontend обращается к
нему через внутреннюю Docker-сеть (`http://api:3001`), проброс на `127.0.0.1:3401` нужен
только для локальной диагностики с самого сервера.

## 5. Автозапуск при перезагрузке сервера

`docker compose` с `restart: unless-stopped` уже обеспечивает автозапуск контейнеров при
поднятии Docker-демона, который в свою очередь стартует со сервером — дополнительный systemd
юнит не требуется.

## 6. Резервное копирование

Family OS хранит данные в двух Docker volumes:
- `family_os_db` — база данных Postgres;
- `family_os_uploads` — файлы пользователей.

Добавить в существующую схему бэкапов сервера (по аналогии с `[backups]` Samba-шарой,
принимающей бэкапы с mt175886):

```bash
# Дамп БД
docker compose exec -T db pg_dump -U family_os family_os > /srv/backups/family-os/db_$(date +%F).sql

# Файлы (volume примонтирован в /var/lib/docker/volumes/…, проще через контейнер)
docker run --rm -v family-os_family_os_uploads:/data -v /srv/backups/family-os:/backup \
  alpine tar czf /backup/uploads_$(date +%F).tar.gz -C /data .
```
Добавить в cron аналогично уже существующим бэкапам (см. `/etc/cron.d/` на сервере).

## 7. После развёртывания — зафиксировать в GLPI

См. `docs/GLPI_RUNBOOK.md`. Кратко: разворачивание Family OS — это инфраструктурное
изменение самого ThinkPad, поэтому фиксируется как GLPI Change + новый Appliance
«Family OS», привязанный к `Computer id=10`, точно так же, как уже зафиксированы AdGuard,
Prometheus, Grafana и т.д.

## 8. Дальнейшее тестирование — уже на сервере

Как и обсуждалось: e2e-тесты backend (`npm run test:e2e` внутри контейнера `api`, либо
локально с `DATABASE_URL`, указывающим на контейнер) — это первый реальный прогон именно на
сервере, поскольку в песочнице агента не было доступа к бинарнику Prisma Engine. Ручная
проверка сценариев (регистрация → 2FA → создание статьи → версии → откат → приглашение
участника → права доступа) тоже логично проводить здесь, в целевой среде.
