-- Family OS — фоновая обработка OCR через очередь (Redis/BullMQ), часть 1/2.
-- ALTER TYPE ... ADD VALUE обязан быть в ОТДЕЛЬНОЙ транзакции от любого
-- использования нового значения (ограничение самого PostgreSQL) — поэтому
-- добавление значений enum и их использование разнесены по разным файлам
-- миграции (Prisma оборачивает каждый файл в одну транзакцию).
ALTER TYPE "DocumentIntakeStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "DocumentIntakeStatus" ADD VALUE 'FAILED';
