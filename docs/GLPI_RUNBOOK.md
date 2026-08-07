# GLPI-раннбук для Family OS (инфраструктурные изменения)

Согласовано с заказчиком: в GLPI фиксируются **только инфраструктурные изменения самого
Family OS** (установка, обновление версии, инциденты) — так же, как уже фиксируются AdGuard,
Prometheus, Grafana и другие сервисы на ThinkPad. Бизнес-данные семьи (документы, статьи
базы знаний, финансы и т.д.) в GLPI НЕ дублируются — GLPI не является источником правды для
пользовательских данных Family OS, это разные системы с разной ответственностью.

Family OS **не вызывает GLPI API из своего кода** — это сознательное архитектурное решение,
а не пропущенная задача (см. `TECH_DEBT.md`, п.8). Автоматический вызов GLPI из бизнес-кода
привязал бы жизненный цикл семейного приложения к доступности отдельной ITSM-системы и смешал
бы два разных домена ответственности. Вместо этого — набор скриптов ниже, использующих тот же
подход, что и уже существующие `glpi_create_change_dhcp.sh` и подобные на сервере.

## Когда фиксировать

- Первое развёртывание Family OS → **Appliance** «Family OS» + привязка к `Computer id=10`.
- Каждое обновление версии/миграция БД в проде → **Change**.
- Инцидент (сервис недоступен, потеря данных, уязвимость) → **Problem**.

## 1. Появление сервиса в GLPI (один раз, при первом развёртывании)

```bash
GLPI_URL="http://100.75.105.102:8090"     # только через Tailscale
APP_TOKEN="<из защищённого хранилища секретов, НЕ из старой заметки в открытом виде>"
USER_TOKEN="<из защищённого хранилища секретов>"
THINKPAD_ID=10

SESSION=$(curl -s -X GET "$GLPI_URL/apirest.php/initSession" \
  -H "App-Token: $APP_TOKEN" -H "Authorization: user_token $USER_TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")

APP_RESP=$(curl -s -X POST "$GLPI_URL/apirest.php/Appliance" \
  -H "Content-Type: application/json" \
  -H "App-Token: $APP_TOKEN" -H "Session-Token: $SESSION" \
  -d '{
    "input": {
      "name": "Family OS (Web)",
      "comment": "Порт 3400 (web) / 3401 (api, localhost only). Docker compose в /opt/family-os. Креды — в менеджере секретов, не здесь."
    }
  }')
APP_ID=$(echo "$APP_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -s -X POST "$GLPI_URL/apirest.php/Appliance_Item" \
  -H "Content-Type: application/json" \
  -H "App-Token: $APP_TOKEN" -H "Session-Token: $SESSION" \
  -d "{\"input\": {\"appliances_id\": $APP_ID, \"itemtype\": \"Computer\", \"items_id\": $THINKPAD_ID}}"

curl -s "$GLPI_URL/apirest.php/killSession" -H "App-Token: $APP_TOKEN" -H "Session-Token: $SESSION" > /dev/null
```

## 2. Фиксация каждого значимого изменения (Change)

Используйте тот же паттерн, что и в проектной заметке про ThinkPad
(раздел «Создать Change и привязать к ThinkPad»):

```bash
curl -s -X POST "$GLPI_URL/apirest.php/Change" \
  -H "Content-Type: application/json" \
  -H "App-Token: $APP_TOKEN" -H "Session-Token: $SESSION" \
  -d '{
    "input": {
      "name": "Family OS: развёрнута Итерация 1 (фундамент)",
      "content": "Развёрнут backend (NestJS), frontend (Next.js), PostgreSQL 16. Порты 3400/3401. Миграция prisma/migrations/20260807000000_init применена.",
      "status": "6",
      "impact": "2", "urgency": "2", "priority": "2"
    }
  }'
```
Затем привязать через `Change_Item` к `Computer id=10`, как описано в исходной заметке
проекта.

## 3. Инцидент (Problem)

Тот же паттерн, что и в проектной заметке — раздел «Создать Problem и привязать к ThinkPad».

## Важное замечание по безопасности

В существующей заметке `__Домашний_сервер___ThinkPad__полная_характеристика_.md` токены
GLPI (`APP_TOKEN`, `USER_TOKEN`) хранятся в открытом виде прямо в markdown-файле. Это стоит
исправить независимо от Family OS: вынести их в менеджер секретов (Bitwarden/KeePass, как и
предполагается для остальных секретов проекта), заменить упоминания в заметке на ссылку на
запись в менеджере, и ротировать сами токены, раз они уже были в файле, который выходил за
пределы сервера.
