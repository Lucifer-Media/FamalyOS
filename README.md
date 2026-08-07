# Family OS — Итерация 1 (фундамент)

Единая семейная информационная система: люди, документы, файлы, семейная база знаний,
права доступа, версионирование, аудит. Подробная концепция всего проекта — в исходных
документах заказчика; техническая реализация Итерации 1 описана здесь.

## Быстрый старт (локальная разработка)

```bash
# 1. Postgres (локально или через Docker)
docker run -d --name family-os-dev-db -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=family_os -p 5432:5432 postgres:16-alpine

# 2. Backend
cd apps/api
cp .env.example .env               # заполнить секреты (openssl rand -hex 32)
npm install
npx prisma generate
npx prisma migrate deploy          # применит уже проверенную вручную миграцию
npm run seed                       # опционально — демо-данные
npm run start:dev                  # http://localhost:3001

# 3. Frontend (в другом терминале)
cd apps/web
cp .env.local.example .env.local
npm install
npm run dev                        # http://localhost:3000
```

Демо-вход после `npm run seed`: `owner@example.com` / `DemoPassword123!` (2FA потребуется
настроить при первом входе — это обязательное требование системы, не баг).

## Структура репозитория

```
family-os/
├── apps/
│   ├── api/             NestJS backend + Prisma
│   └── web/              Next.js frontend
├── docs/
│   ├── ARCHITECTURE.md         архитектурные решения и инварианты
│   ├── API.md                  справочник эндпоинтов
│   ├── DEPLOYMENT.md           разворачивание на ThinkPad (домашний сервер)
│   ├── GLPI_RUNBOOK.md         фиксация инфраструктурных изменений в GLPI
│   ├── KNOWN_LIMITATIONS.md    что реально проверено агентом, а что нет — честно
│   └── TECH_DEBT.md            зафиксированный технический долг Итерации 1
├── docker-compose.yml   продакшн-развёртывание (см. DEPLOYMENT.md)
└── .env.production.example
```

## Статус проверки (см. подробности в docs/KNOWN_LIMITATIONS.md)

| Что | Статус |
|---|---|
| Схема БД / миграция | ✅ Применена и проверена напрямую через `psql` (15 таблиц) |
| Backend компилируется | ✅ 0 ошибок, кроме недостающих типов `@prisma/client` (нужен `prisma generate` с обычным интернетом) |
| Юнит-тесты бизнес-логики | ✅ 10/10 реально запущены и проходят |
| Frontend собирается | ✅ `next build` полностью прошёл, включая проверку типов, все 13 маршрутов |
| E2E-тесты API | ⏳ Написаны, первый реальный прогон — на сервере (нужен `prisma generate`) |
| Docker-образы | ⏳ Написаны по образцу существующих сервисов ThinkPad, не собирались в песочнице (нет Docker) |

## Дальше

Читайте `docs/DEPLOYMENT.md` для разворачивания на вашем ThinkPad-сервере.
