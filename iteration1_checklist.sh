#!/usr/bin/env bash
# Family OS — автоматизированная проверка критических пунктов чек-листа Итерации 1.
# Запускать на сервере ThinkPad из /opt/family-os.
# Ничего не трогает в проде — создаёт отдельные тестовые семьи/пользователей
# и сам их не удаляет (чтобы вы могли посмотреть глазами), но помечает как ТЕСТ.
set -uo pipefail

API="http://127.0.0.1:3401"
WEB="http://192.168.1.18:3400"
PASS=0
FAIL=0
FAILED_NAMES=()

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    PASS=$((PASS+1))
    echo "  ✅ $name (ожидали $expected, получили $actual)"
  else
    FAIL=$((FAIL+1))
    FAILED_NAMES+=("$name")
    echo "  ❌ $name (ОЖИДАЛИ $expected, ПОЛУЧИЛИ $actual)"
  fi
}

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }

echo "=== 1. Изоляция семей (раздел 3.2 чек-листа) ==="

# Семья А, пользователь А1
REG_A1=$(curl -s -X POST "$API/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"iso-a1@test.local","password":"password12345","fullName":"А1 Тест","familySpaceName":"[ТЕСТ] Семья А"}')
TOKEN_A1=$(echo "$REG_A1" | json "['accessToken']")
SPACE_A=$(echo "$REG_A1" | json "['familySpace']['id']")

# Семья Б, пользователь Б1
REG_B1=$(curl -s -X POST "$API/auth/register" -H "Content-Type: application/json" \
  -d '{"email":"iso-b1@test.local","password":"password12345","fullName":"Б1 Тест","familySpaceName":"[ТЕСТ] Семья Б"}')
TOKEN_B1=$(echo "$REG_B1" | json "['accessToken']")
SPACE_B=$(echo "$REG_B1" | json "['familySpace']['id']")

# А1 приглашает А2 в семью А
INVITE_A2=$(curl -s -X POST "$API/family-spaces/$SPACE_A/invitations" \
  -H "Authorization: Bearer $TOKEN_A1" -H "X-Family-Space-Id: $SPACE_A" -H "Content-Type: application/json" \
  -d '{"email":"iso-a2@test.local","role":"ADULT"}')
INVITE_TOKEN=$(echo "$INVITE_A2" | json "['token']")
ACCEPT_A2=$(curl -s -X POST "$API/invitations/$INVITE_TOKEN/accept-new-user" -H "Content-Type: application/json" \
  -d '{"password":"password12345","fullName":"А2 Тест"}')

# Логинимся как А2 (accept-new-user не выдаёт токен напрямую по дизайну — логинимся)
LOGIN_A2=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"iso-a2@test.local","password":"password12345"}')
TOKEN_A2=$(echo "$LOGIN_A2" | json "['accessToken']")

# А1 создаёт статью в семье А
ARTICLE=$(curl -s -X POST "$API/knowledge-base/articles" \
  -H "Authorization: Bearer $TOKEN_A1" -H "X-Family-Space-Id: $SPACE_A" -H "Content-Type: application/json" \
  -d '{"title":"[ТЕСТ] Секрет семьи А","content":"конфиденциально"}')
ARTICLE_ID=$(echo "$ARTICLE" | json "['id']")

# А2 должен ВИДЕТЬ статью семьи А
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/knowledge-base/articles/$ARTICLE_ID" \
  -H "Authorization: Bearer $TOKEN_A2" -H "X-Family-Space-Id: $SPACE_A")
check "А2 видит данные семьи А" "200" "$STATUS"

# Б1 НЕ должен получить доступ к статье семьи А, даже указав чужой SPACE_A в заголовке
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/knowledge-base/articles/$ARTICLE_ID" \
  -H "Authorization: Bearer $TOKEN_B1" -H "X-Family-Space-Id: $SPACE_A")
check "Б1 НЕ видит данные семьи А (чужой X-Family-Space-Id)" "403" "$STATUS"

# Б1 НЕ должен получить статью А даже через свою легитимную семью Б (IDOR-проверка по id)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/knowledge-base/articles/$ARTICLE_ID" \
  -H "Authorization: Bearer $TOKEN_B1" -H "X-Family-Space-Id: $SPACE_B")
check "Б1 НЕ видит статью А через IDOR (свой SPACE_B + чужой article id)" "404" "$STATUS"

# Список статей семьи Б не должен содержать статью семьи А
LIST_B=$(curl -s "$API/knowledge-base/articles" -H "Authorization: Bearer $TOKEN_B1" -H "X-Family-Space-Id: $SPACE_B")
CONTAINS=$(echo "$LIST_B" | grep -c "$ARTICLE_ID" || true)
check "Список статей семьи Б не содержит статью семьи А" "0" "$CONTAINS"

echo ""
echo "=== 2. Права доступа по ролям (раздел 4) ==="

# А1 приглашает ребёнка в семью А
INVITE_CHILD=$(curl -s -X POST "$API/family-spaces/$SPACE_A/invitations" \
  -H "Authorization: Bearer $TOKEN_A1" -H "X-Family-Space-Id: $SPACE_A" -H "Content-Type: application/json" \
  -d '{"email":"iso-child@test.local","role":"CHILD"}')
INVITE_TOKEN_CHILD=$(echo "$INVITE_CHILD" | json "['token']")
curl -s -X POST "$API/invitations/$INVITE_TOKEN_CHILD/accept-new-user" -H "Content-Type: application/json" \
  -d '{"password":"password12345","fullName":"Ребёнок Тест"}' > /dev/null
LOGIN_CHILD=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"iso-child@test.local","password":"password12345"}')
TOKEN_CHILD=$(echo "$LOGIN_CHILD" | json "['accessToken']")

# Ребёнок должен УМЕТЬ читать базу знаний
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/knowledge-base/articles/$ARTICLE_ID" \
  -H "Authorization: Bearer $TOKEN_CHILD" -H "X-Family-Space-Id: $SPACE_A")
check "Ребёнок МОЖЕТ читать базу знаний (VIEW разрешён)" "200" "$STATUS"

# Ребёнок НЕ должен уметь создавать статьи
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/knowledge-base/articles" \
  -H "Authorization: Bearer $TOKEN_CHILD" -H "X-Family-Space-Id: $SPACE_A" -H "Content-Type: application/json" \
  -d '{"title":"Ребёнок пытается писать","content":"тест"}')
check "Ребёнок НЕ может создавать статьи (CREATE запрещён)" "403" "$STATUS"

# Ребёнок НЕ должен видеть журнал аудита
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/audit-log" \
  -H "Authorization: Bearer $TOKEN_CHILD" -H "X-Family-Space-Id: $SPACE_A")
check "Ребёнок НЕ видит журнал аудита" "403" "$STATUS"

# А1 (владелец) должен видеть журнал аудита
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/audit-log" \
  -H "Authorization: Bearer $TOKEN_A1" -H "X-Family-Space-Id: $SPACE_A")
check "Владелец видит журнал аудита" "200" "$STATUS"

echo ""
echo "=== 3. Авторизация и IDOR (раздел 5) ==="

# Неавторизованный запрос отклоняется
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/knowledge-base/articles" -H "X-Family-Space-Id: $SPACE_A")
check "Неавторизованный запрос отклонён" "401" "$STATUS"

# Неверный пароль отклоняется
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"iso-a1@test.local","password":"wrong-password-xxx"}')
check "Неверный пароль отклонён" "401" "$STATUS"

# Просроченный/поддельный токен отклоняется
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API/knowledge-base/articles" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.fake.token" -H "X-Family-Space-Id: $SPACE_A")
check "Поддельный JWT-токен отклонён" "401" "$STATUS"

echo ""
echo "=== 4. Безопасность (раздел 15) — быстрые проверки ==="

# .env не доступен через web
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WEB/.env")
check ".env недоступен через web" "404" "$STATUS"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WEB/docker-compose.yml")
check "docker-compose.yml недоступен через web" "404" "$STATUS"

# Пароль не возвращается в ответе логина
LOGIN_CHECK=$(curl -s -X POST "$API/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"iso-a1@test.local","password":"password12345"}')
HAS_HASH=$(echo "$LOGIN_CHECK" | grep -c "passwordHash" || true)
check "passwordHash отсутствует в ответе /auth/login" "0" "$HAS_HASH"

# Секреты не в докер-логах (последние 500 строк каждого сервиса)
SECRET_IN_LOGS=$(docker compose logs --tail=500 2>/dev/null | grep -c "$(grep TWO_FACTOR_ENC_KEY .env | cut -d= -f2)" || true)
check "TWO_FACTOR_ENC_KEY не светится в docker logs" "0" "$SECRET_IN_LOGS"

echo ""
echo "=========================================="
echo "ИТОГО: $PASS пройдено, $FAIL провалено из $((PASS+FAIL))"
if [ $FAIL -gt 0 ]; then
  echo "Провалившиеся проверки:"
  for n in "${FAILED_NAMES[@]}"; do echo "  - $n"; done
fi
echo "=========================================="
echo ""
echo "Тестовые данные остались в БД (email вида iso-*@test.local, семьи '[ТЕСТ] Семья А/Б')."
echo "Удалить их можно после проверки — см. инструкцию в чате."
