# Family OS API (Итерация 1)

Базовый URL: `http://<host>:3401` (за прокси frontend'а — `/api/*`).

Все защищённые эндпоинты требуют:
- заголовок `Authorization: Bearer <accessToken>`;
- заголовок `X-Family-Space-Id: <id>` (кроме `/auth/*` и `/family-spaces`).

## Auth

| Метод | Путь | Описание |
|---|---|---|
| POST | `/auth/register` | Регистрация: создаёт User + FamilySpace + Person + Membership(OWNER) |
| POST | `/auth/login` | Вход (email, password, опционально twoFactorCode) |
| POST | `/auth/refresh` | Обновление access-токена по refresh-токену |
| POST | `/auth/logout` | Отзыв refresh-токена |
| POST | `/auth/2fa/setup` | Инициализация 2FA — QR-код + recovery-коды |
| POST | `/auth/2fa/confirm` | Подтверждение 2FA кодом — включает 2FA |
| POST | `/auth/2fa/disable` | Отключение 2FA (требует пароль) |

## Family Spaces / Members

| Метод | Путь | Описание |
|---|---|---|
| GET | `/family-spaces` | Список пространств текущего пользователя |
| GET | `/family-spaces/:id` | Детали пространства |
| PATCH | `/family-spaces/:id/base-currency` | Смена базовой валюты (только OWNER) |
| GET | `/family-spaces/:id/members` | Список участников |
| POST | `/family-spaces/:id/invitations` | Пригласить участника (OWNER/PARTNER) |
| POST | `/invitations/:token/accept-new-user` | Принять приглашение (новый пользователь) |
| PATCH | `/family-spaces/:id/members/:membershipId/role` | Сменить роль |
| PATCH | `/family-spaces/:id/members/:membershipId/status` | Приостановить/восстановить членство |
| POST | `/family-spaces/:id/members/:membershipId/permission-overrides` | Точечное исключение из прав (только OWNER) |

## People

| Метод | Путь | Описание |
|---|---|---|
| GET | `/people` | Список профилей людей в пространстве |
| POST | `/people` | Создать профиль (напр. ребёнок без логина) |
| PATCH | `/people/:id` | Изменить профиль |
| PATCH | `/people/:id/archive` | Архивировать профиль |

## Entities (универсальный движок)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/entities` | Создать сущность любого `entityType` |
| GET | `/entities?entityType=&status=&ownerPersonId=` | Список с фильтрами |
| GET | `/entities/:id` | Одна сущность |
| PATCH | `/entities/:id` | Изменить (создаёт новую версию) |
| PATCH | `/entities/:id/archive` \| `/unarchive` \| `/void` | Смена статуса (без удаления) |
| GET | `/entities/:id/versions` | История версий |
| POST | `/entities/:id/revert` | Откат к версии (создаёт новую версию) |
| POST | `/entities/:id/links` | Связать с другой сущностью |
| GET | `/entities/:id/links` | Входящие/исходящие связи |

## Knowledge Base (специализация Entity)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/knowledge-base/articles` | Создать статью (title, content, folder, tags) |
| GET | `/knowledge-base/articles` | Список статей |
| GET | `/knowledge-base/articles/:id` | Одна статья |
| PATCH | `/knowledge-base/articles/:id` | Изменить |
| GET | `/knowledge-base/articles/:id/versions` | История версий |
| POST | `/knowledge-base/articles/:id/revert` | Откат к версии |
| PATCH | `/knowledge-base/articles/:id/archive` | Архивировать |

## Files

| Метод | Путь | Описание |
|---|---|---|
| GET | `/files` | Список файлов пространства |
| POST | `/files` | Загрузить (multipart: file, confidentialityLevel?, entityId?, relationRole?) |
| GET | `/files/:id` | Метаданные файла |
| GET | `/files/:id/versions` | История версий файла |
| POST | `/files/:id/versions` | Загрузить новую версию файла |
| GET | `/files/:id/download` | Скачать текущую версию |
| PATCH | `/files/:id/archive` | Архивировать |

## Search

| Метод | Путь | Описание |
|---|---|---|
| GET | `/search?q=<запрос>` | Полнотекстовый поиск по сущностям (Postgres FTS, конфигурация `russian`) |

## Audit

| Метод | Путь | Описание |
|---|---|---|
| GET | `/audit-log?limit=&action=` | Журнал аудита пространства (только OWNER/PARTNER) |

## Health

| Метод | Путь | Описание |
|---|---|---|
| GET | `/health` | Проверка доступности + реального подключения к БД |
