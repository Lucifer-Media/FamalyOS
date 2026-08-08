-- Family OS — фоновая обработка OCR через очередь (Redis/BullMQ), часть 2/2.
-- Значения PROCESSING/FAILED уже закоммичены предыдущей миграцией — здесь
-- их можно безопасно использовать.

-- Новая задача сразу встаёт в очередь — статус по умолчанию теперь PROCESSING,
-- а не PENDING (PENDING наступает только после того, как воркер закончил OCR).
ALTER TABLE "document_intakes" ALTER COLUMN "status" SET DEFAULT 'PROCESSING';

ALTER TABLE "document_intakes" ADD COLUMN "processingError" TEXT;
