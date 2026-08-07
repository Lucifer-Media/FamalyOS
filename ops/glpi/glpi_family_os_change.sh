#!/usr/bin/env bash
# Фиксирует Change в GLPI для изменения Family OS и привязывает к Computer id=10.
# Использование: GLPI_CHANGE_NAME="..." GLPI_CHANGE_CONTENT="..." ./glpi_family_os_change.sh
set -euo pipefail

: "${GLPI_URL:?укажите GLPI_URL}"
: "${GLPI_APP_TOKEN:?укажите GLPI_APP_TOKEN}"
: "${GLPI_USER_TOKEN:?укажите GLPI_USER_TOKEN}"
: "${THINKPAD_COMPUTER_ID:=10}"
: "${GLPI_CHANGE_NAME:?укажите краткое название изменения}"
: "${GLPI_CHANGE_CONTENT:?укажите подробное описание изменения}"

SESSION=$(curl -s -X GET "$GLPI_URL/apirest.php/initSession" \
  -H "App-Token: $GLPI_APP_TOKEN" -H "Authorization: user_token $GLPI_USER_TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['session_token'])")

CHANGE_RESP=$(curl -s -X POST "$GLPI_URL/apirest.php/Change" \
  -H "Content-Type: application/json" \
  -H "App-Token: $GLPI_APP_TOKEN" -H "Session-Token: $SESSION" \
  -d "{\"input\": {\"name\": \"$GLPI_CHANGE_NAME\", \"content\": \"$GLPI_CHANGE_CONTENT\", \"status\": \"6\", \"impact\": \"2\", \"urgency\": \"2\", \"priority\": \"2\"}}")
CHANGE_ID=$(echo "$CHANGE_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Change создан: id=$CHANGE_ID"

curl -s -X POST "$GLPI_URL/apirest.php/Change_Item" \
  -H "Content-Type: application/json" \
  -H "App-Token: $GLPI_APP_TOKEN" -H "Session-Token: $SESSION" \
  -d "{\"input\": {\"changes_id\": $CHANGE_ID, \"itemtype\": \"Computer\", \"items_id\": $THINKPAD_COMPUTER_ID}}"

curl -s "$GLPI_URL/apirest.php/killSession" -H "App-Token: $GLPI_APP_TOKEN" -H "Session-Token: $SESSION" > /dev/null
echo "Готово."
