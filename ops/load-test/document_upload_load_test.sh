#!/usr/bin/env bash
# Family OS — нагрузочная проверка загрузки документов (раздел 22 ТЗ Итерации 2).
# Не выдумываю цифры — этот скрипт вы запускаете сами на своём сервере и
# смотрите реальный результат для вашего железа.
#
# Использование:
#   API_URL=http://127.0.0.1:3401 EMAIL=owner@example.com PASSWORD=... \
#     FAMILY_SPACE_ID=<id> ./document_upload_load_test.sh /path/to/test.jpg 20
set -euo pipefail

API_URL="${API_URL:-http://127.0.0.1:3401}"
EMAIL="${EMAIL:?укажите EMAIL}"
PASSWORD="${PASSWORD:?укажите PASSWORD}"
FAMILY_SPACE_ID="${FAMILY_SPACE_ID:?укажите FAMILY_SPACE_ID}"
TWO_FACTOR_CODE="${TWO_FACTOR_CODE:-}"

TEST_FILE="${1:?укажите путь к тестовому файлу (JPG/PNG/PDF)}"
COUNT="${2:-20}"

echo "=== Вход ==="
LOGIN_BODY=$(python3 -c "import json,sys; print(json.dumps({'email': sys.argv[1], 'password': sys.argv[2], **({'twoFactorCode': sys.argv[3]} if sys.argv[3] else {})}))" "$EMAIL" "$PASSWORD" "$TWO_FACTOR_CODE")
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d "$LOGIN_BODY")
TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

if [ -z "$TOKEN" ]; then
  echo "Не удалось получить токен. Ответ сервера: $LOGIN_RESPONSE"
  exit 1
fi

echo "=== Загрузка $COUNT документов подряд (файл: $TEST_FILE) ==="
START=$(date +%s)
INTAKE_IDS=()

for i in $(seq 1 "$COUNT"); do
  UPLOAD_START=$(date +%s%N)
  FILE_RESPONSE=$(curl -s -X POST "$API_URL/files" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Family-Space-Id: $FAMILY_SPACE_ID" \
    -F "file=@$TEST_FILE")
  FILE_ID=$(echo "$FILE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

  INTAKE_RESPONSE=$(curl -s -X POST "$API_URL/document-intake/from-file/$FILE_ID" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Family-Space-Id: $FAMILY_SPACE_ID")
  INTAKE_ID=$(echo "$INTAKE_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['intake']['id'])")
  INTAKE_IDS+=("$INTAKE_ID")

  UPLOAD_END=$(date +%s%N)
  ELAPSED_MS=$(( (UPLOAD_END - UPLOAD_START) / 1000000 ))
  echo "[$i/$COUNT] загружено за ${ELAPSED_MS}мс, intake=$INTAKE_ID (HTTP-запрос не ждёт OCR — это и есть цель очереди)"
done

UPLOAD_PHASE_END=$(date +%s)
echo ""
echo "Все $COUNT файлов загружены за $((UPLOAD_PHASE_END - START)) секунд (без ожидания OCR)."
echo "Если интерфейс/API не блокировался во время загрузки — очередь работает как задумано."

echo ""
echo "=== Ждём завершения фоновой обработки (до 5 минут) ==="
DEADLINE=$((SECONDS + 300))
while [ $SECONDS -lt $DEADLINE ]; do
  PENDING_OR_PROCESSING=0
  for id in "${INTAKE_IDS[@]}"; do
    STATUS=$(curl -s "$API_URL/document-intake/$id" \
      -H "Authorization: Bearer $TOKEN" -H "X-Family-Space-Id: $FAMILY_SPACE_ID" \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['intake']['status'])")
    if [ "$STATUS" == "PROCESSING" ]; then
      PENDING_OR_PROCESSING=$((PENDING_OR_PROCESSING+1))
    fi
  done
  echo "Ещё в обработке: $PENDING_OR_PROCESSING из ${#INTAKE_IDS[@]}"
  if [ "$PENDING_OR_PROCESSING" -eq 0 ]; then break; fi
  sleep 5
done

TOTAL_END=$(date +%s)
echo ""
echo "=== ИТОГ ==="
echo "Документов: $COUNT"
echo "Время загрузки (без OCR): $((UPLOAD_PHASE_END - START)) сек"
echo "Общее время включая фоновую обработку: $((TOTAL_END - START)) сек"
echo "Среднее время обработки одного документа: $(( (TOTAL_END - UPLOAD_PHASE_END) / COUNT )) сек"
