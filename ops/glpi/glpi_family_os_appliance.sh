#!/usr/bin/env bash
# Регистрирует Family OS как Appliance в GLPI и привязывает к Computer id=10 (ThinkPad).
# Запускать один раз при первом развёртывании, с машины с доступом к Tailscale.
# См. docs/GLPI_RUNBOOK.md. Токены — брать из менеджера секретов, НЕ хардкодить здесь.
set -euo pipefail

: "${GLPI_URL:?укажите GLPI_URL, напр. http://100.75.105.102:8090}"
: "${GLPI_APP_TOKEN:?укажите GLPI_APP_TOKEN}"
: "${GLPI_USER_TOKEN:?укажите GLPI_USER_TOKEN}"
: "${THINKPAD_COMPUTER_ID:=10}"

SESSION=$(curl -s -X GET "$GLPI_URL/apirest.php/initSession" \
  -H "App-Token: $GLPI_APP_TOKEN" -H "Authorization: user_token $GLPI_USER_TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")

APP_RESP=$(curl -s -X POST "$GLPI_URL/apirest.php/Appliance" \
  -H "Content-Type: application/json" \
  -H "App-Token: $GLPI_APP_TOKEN" -H "Session-Token: $SESSION" \
  -d '{
    "input": {
      "name": "Family OS (Web)",
      "comment": "Порт 3400 (web) / 3401 (api, localhost only). Docker compose в /opt/family-os."
    }
  }')
APP_ID=$(echo "$APP_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Appliance создан: id=$APP_ID"

curl -s -X POST "$GLPI_URL/apirest.php/Appliance_Item" \
  -H "Content-Type: application/json" \
  -H "App-Token: $GLPI_APP_TOKEN" -H "Session-Token: $SESSION" \
  -d "{\"input\": {\"appliances_id\": $APP_ID, \"itemtype\": \"Computer\", \"items_id\": $THINKPAD_COMPUTER_ID}}"

curl -s "$GLPI_URL/apirest.php/killSession" -H "App-Token: $GLPI_APP_TOKEN" -H "Session-Token: $SESSION" > /dev/null
echo "Готово."
