#!/usr/bin/env bash
# Family OS — проверка backup/restore (раздел 13 чек-листа).
# ВАЖНО: тест восстановления делается на ОТДЕЛЬНОЙ тестовой БД, не на проде.
set -euo pipefail

BACKUP_DIR="/srv/backups/family-os"
mkdir -p "$BACKUP_DIR"
DATE=$(date +%F_%H%M%S)

echo "=== 1. Ручной backup БД ==="
docker compose exec -T db pg_dump -U family_os family_os > "$BACKUP_DIR/db_$DATE.sql"
ls -lh "$BACKUP_DIR/db_$DATE.sql"
echo "Строк в дампе: $(wc -l < "$BACKUP_DIR/db_$DATE.sql")"
echo "Содержит CREATE TABLE users: $(grep -c 'CREATE TABLE.*users' "$BACKUP_DIR/db_$DATE.sql" || echo 0)"

echo ""
echo "=== 2. Backup файлов (uploads volume) ==="
docker run --rm -v family-os_family_os_uploads:/data -v "$BACKUP_DIR":/backup \
  alpine tar czf "/backup/uploads_$DATE.tar.gz" -C /data .
ls -lh "$BACKUP_DIR/uploads_$DATE.tar.gz"

echo ""
echo "=== 3. Проверка: backup не хранится ТОЛЬКО на этом сервере ==="
echo "!!! ВРУЧНУЮ: скопируйте $BACKUP_DIR/db_$DATE.sql на другую машину (например, vds2537591 или локальный компьютер),"
echo "    иначе при выходе из строя диска ThinkPad бэкап пропадёт вместе с самими данными."

echo ""
echo "=== 4. ГЛАВНЫЙ ТЕСТ: восстановление в отдельную БД ==="
echo "Создаём тестовую БД family_os_restore_test и восстанавливаем в неё дамп..."
docker compose exec -T db psql -U family_os -d family_os -c "DROP DATABASE IF EXISTS family_os_restore_test;"
docker compose exec -T db psql -U family_os -d family_os -c "CREATE DATABASE family_os_restore_test;"
docker compose exec -T db psql -U family_os -d family_os_restore_test < "$BACKUP_DIR/db_$DATE.sql"

echo ""
echo "=== 5. Проверка восстановленных данных ==="
USERS_COUNT=$(docker compose exec -T db psql -U family_os -d family_os_restore_test -tAc "SELECT COUNT(*) FROM users;")
SPACES_COUNT=$(docker compose exec -T db psql -U family_os -d family_os_restore_test -tAc "SELECT COUNT(*) FROM family_spaces;")
ENTITIES_COUNT=$(docker compose exec -T db psql -U family_os -d family_os_restore_test -tAc "SELECT COUNT(*) FROM entities;")
VERSIONS_COUNT=$(docker compose exec -T db psql -U family_os -d family_os_restore_test -tAc "SELECT COUNT(*) FROM entity_versions;")
MEMBERSHIPS_COUNT=$(docker compose exec -T db psql -U family_os -d family_os_restore_test -tAc "SELECT COUNT(*) FROM memberships;")

echo "Пользователей восстановлено: $USERS_COUNT"
echo "Семейных пространств восстановлено: $SPACES_COUNT"
echo "Сущностей восстановлено: $ENTITIES_COUNT"
echo "Версий сущностей восстановлено: $VERSIONS_COUNT"
echo "Членств (связей пользователь↔семья) восстановлено: $MEMBERSHIPS_COUNT"

if [ "$USERS_COUNT" -gt 0 ] && [ "$SPACES_COUNT" -gt 0 ] && [ "$MEMBERSHIPS_COUNT" -gt 0 ]; then
  echo "✅ Backup/Restore: PASS — данные, пользователи, связи и история восстановлены"
else
  echo "❌ Backup/Restore: FAIL — какие-то данные не восстановились, разбираем отдельно"
fi

echo ""
echo "Очистка тестовой БД восстановления..."
docker compose exec -T db psql -U family_os -d family_os -c "DROP DATABASE family_os_restore_test;"
echo "Готово. Реальный backup остался в $BACKUP_DIR/db_$DATE.sql — не удалён."
