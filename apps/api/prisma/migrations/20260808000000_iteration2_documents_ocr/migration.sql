-- Family OS — Итерация 2: документы, иерархия сущностей (локации), OCR-конвейер.

-- CreateEnum
CREATE TYPE "OcrEngine" AS ENUM ('TESSERACT');
CREATE TYPE "DocumentIntakeStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- AlterTable: иерархия сущностей (нужна для локаций: Страна → Город → Дом → Квартира → Комната)
ALTER TABLE "entities" ADD COLUMN "parentEntityId" TEXT;
ALTER TABLE "entities" ADD CONSTRAINT "entities_parentEntityId_fkey"
  FOREIGN KEY ("parentEntityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "entities_parentEntityId_idx" ON "entities"("parentEntityId");

-- CreateTable: результаты OCR/извлечения текста
CREATE TABLE "file_ocr_results" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileVersion" INTEGER NOT NULL,
    "engine" "OcrEngine" NOT NULL DEFAULT 'TESSERACT',
    "language" TEXT NOT NULL DEFAULT 'rus',
    "textSource" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorMessage" TEXT,
    "rawBlocks" JSONB,
    CONSTRAINT "file_ocr_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "file_ocr_results_fileId_idx" ON "file_ocr_results"("fileId");
ALTER TABLE "file_ocr_results" ADD CONSTRAINT "file_ocr_results_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: промежуточный этап "загрузка → OCR → классификация → подтверждение"
CREATE TABLE "document_intakes" (
    "id" TEXT NOT NULL,
    "familySpaceId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "ocrResultId" TEXT,
    "suggestedEntityType" TEXT,
    "suggestedAttributes" JSONB,
    "suggestedConfidence" DOUBLE PRECISION,
    "status" "DocumentIntakeStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedEntityId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "document_intakes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "document_intakes_familySpaceId_status_idx" ON "document_intakes"("familySpaceId", "status");
ALTER TABLE "document_intakes" ADD CONSTRAINT "document_intakes_familySpaceId_fkey"
  FOREIGN KEY ("familySpaceId") REFERENCES "family_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_intakes" ADD CONSTRAINT "document_intakes_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_intakes" ADD CONSTRAINT "document_intakes_confirmedEntityId_fkey"
  FOREIGN KEY ("confirmedEntityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
