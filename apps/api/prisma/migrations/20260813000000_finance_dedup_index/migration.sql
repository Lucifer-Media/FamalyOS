-- Family OS — быстрое обнаружение дублей при импорте банковских выписок.
-- Сканировать JSONB attributes всех financial_transaction на каждый импорт
-- (выписки могут содержать тысячи операций) было бы медленно и ненадёжно —
-- этот индекс даёт O(1) проверку "эта операция уже импортирована?".

CREATE TABLE "financial_transaction_external_ids" (
    "id" TEXT NOT NULL,
    "familySpaceId" TEXT NOT NULL,
    "accountEntityId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "transactionEntityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_transaction_external_ids_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "financial_transaction_external_ids_account_external_key"
  ON "financial_transaction_external_ids"("accountEntityId", "externalId");

CREATE UNIQUE INDEX "financial_transaction_external_ids_transactionEntityId_key"
  ON "financial_transaction_external_ids"("transactionEntityId");

ALTER TABLE "financial_transaction_external_ids" ADD CONSTRAINT "financial_transaction_external_ids_accountEntityId_fkey"
  FOREIGN KEY ("accountEntityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_transaction_external_ids" ADD CONSTRAINT "financial_transaction_external_ids_transactionEntityId_fkey"
  FOREIGN KEY ("transactionEntityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
