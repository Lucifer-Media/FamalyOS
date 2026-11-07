#!/usr/bin/env bash
# =============================================================================
# Family OS — РАЗОВАЯ физическая очистка ТЕСТОВЫХ финансовых операций.
#
# ВНИМАНИЕ. В приложении удаление запрещено (только архив) — это осознанное
# исключение для мусора, заведённого во время тестирования, до ввода модуля
# в эксплуатацию. Для обычной работы используйте «Финансы → Очистка»
# (архивирование, обратимо).
#
# Что удаляет (только entityType = financial_transaction по фильтру):
#   - сами операции (entities), их версии (entity_versions), связи
#     (entity_links), привязки файлов (entity_files) и людей (entity_person_links),
#     ключи дедупликации импорта (financial_transaction_external_ids);
#   - ссылки на них из document_intakes обнуляются (сами intake не трогаются);
#   - relatedTransactionId у оставшихся операций, указывающий на удалённые, убирается.
# Что НЕ трогает: счета, банки, категории, бюджеты, цели, журнал аудита
# (в него добавляется запись о самой очистке).
#
# По умолчанию — СУХОЙ ПРОГОН: только показывает, что будет удалено.
#
# Использование (на сервере, в /opt/family-os):
#   ./ops/purge-test-finance.sh --all                       # все операции
#   ./ops/purge-test-finance.sh --account <uuid счёта>      # операции одного счёта
#   ./ops/purge-test-finance.sh --created-before 2026-11-08 # заведённые в БД до даты
#   ... добавьте --execute, чтобы реально удалить (перед этим будет pg_dump).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
DB_USER="${POSTGRES_USER:-family_os}"
DB_NAME="${POSTGRES_DB:-family_os}"
CONTAINER="${DB_CONTAINER:-family-os-db}"

MODE=""
VALUE=""
EXECUTE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --all) MODE="all" ;;
    --account) MODE="account"; VALUE="${2:-}"; shift ;;
    --created-before) MODE="created"; VALUE="${2:-}"; shift ;;
    --execute) EXECUTE=1 ;;
    *) echo "Неизвестный аргумент: $1"; exit 1 ;;
  esac
  shift
done

if [ -z "$MODE" ]; then
  echo "Укажите фильтр: --all | --account <uuid> | --created-before ГГГГ-ММ-ДД  (и --execute для реального удаления)"
  exit 1
fi

case "$MODE" in
  all) FILTER="TRUE" ;;
  account)
    [[ "$VALUE" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo "Некорректный uuid счёта"; exit 1; }
    FILTER="e.attributes->>'accountId' = '$VALUE'" ;;
  created)
    [[ "$VALUE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "Дата должна быть ГГГГ-ММ-ДД"; exit 1; }
    FILTER="e.\"createdAt\" < '$VALUE'::date" ;;
esac

psql_run() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"; }

SELECT_IDS="SELECT e.id FROM entities e WHERE e.\"entityType\" = 'financial_transaction' AND ($FILTER)"

echo "=== Будет затронуто ==="
psql_run <<SQL
SELECT count(*) AS "операций",
       min(e.attributes->>'date') AS "первая дата",
       max(e.attributes->>'date') AS "последняя дата",
       count(*) FILTER (WHERE e.status = 'ACTIVE') AS "активных",
       count(*) FILTER (WHERE e.status <> 'ACTIVE') AS "в архиве"
FROM entities e WHERE e."entityType" = 'financial_transaction' AND ($FILTER);

SELECT coalesce(a.title, '(счёт не найден)') AS "счёт", count(*) AS "операций"
FROM entities e LEFT JOIN entities a ON a.id = e.attributes->>'accountId'
WHERE e."entityType" = 'financial_transaction' AND ($FILTER)
GROUP BY 1 ORDER BY 2 DESC;
SQL

if [ "$EXECUTE" -ne 1 ]; then
  echo
  echo "Это был сухой прогон. Ничего не удалено. Для удаления добавьте --execute."
  exit 0
fi

read -r -p "Удалить безвозвратно? Введите УДАЛИТЬ: " CONFIRM
[ "$CONFIRM" = "УДАЛИТЬ" ] || { echo "Отменено."; exit 1; }

mkdir -p backups
BACKUP="backups/before-purge-$(date +%Y%m%d-%H%M%S).sql.gz"
echo "Резервная копия БД → $BACKUP"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$BACKUP"
[ -s "$BACKUP" ] || { echo "Резервная копия пустая — останавливаюсь"; exit 1; }

psql_run <<SQL
BEGIN;
CREATE TEMP TABLE purge_ids ON COMMIT DROP AS $SELECT_IDS;

UPDATE document_intakes SET "confirmedEntityId" = NULL WHERE "confirmedEntityId" IN (SELECT id FROM purge_ids);
UPDATE document_intakes SET "targetEntityId" = NULL WHERE "targetEntityId" IN (SELECT id FROM purge_ids);
UPDATE document_intakes SET "possibleDuplicateOfEntityId" = NULL WHERE "possibleDuplicateOfEntityId" IN (SELECT id FROM purge_ids);

DELETE FROM financial_transaction_external_ids WHERE "transactionEntityId" IN (SELECT id FROM purge_ids);
DELETE FROM entity_links WHERE "sourceEntityId" IN (SELECT id FROM purge_ids) OR "targetEntityId" IN (SELECT id FROM purge_ids);
DELETE FROM entity_files WHERE "entityId" IN (SELECT id FROM purge_ids);
DELETE FROM entity_person_links WHERE "entityId" IN (SELECT id FROM purge_ids);
DELETE FROM entity_versions WHERE "entityId" IN (SELECT id FROM purge_ids);

-- оставшиеся операции не должны ссылаться на удалённые
UPDATE entities SET attributes = attributes - 'relatedTransactionId'
WHERE "entityType" = 'financial_transaction'
  AND attributes->>'relatedTransactionId' IN (SELECT id FROM purge_ids)
  AND id NOT IN (SELECT id FROM purge_ids);

INSERT INTO audit_logs (id, "familySpaceId", action, "resourceType", metadata, "createdAt")
SELECT gen_random_uuid(), e."familySpaceId", 'finance.purge_test_transactions', 'financial_transaction',
       jsonb_build_object('count', count(*), 'mode', '$MODE', 'value', '$VALUE', 'backup', '$BACKUP'), now()
FROM entities e WHERE e.id IN (SELECT id FROM purge_ids) GROUP BY e."familySpaceId";

DELETE FROM entities WHERE id IN (SELECT id FROM purge_ids);
COMMIT;
SQL

echo "Готово. Резервная копия: $BACKUP"
echo "Балансы счетов (поле «Текущий баланс») скрипт не пересчитывает — проверьте их в карточках счетов."
