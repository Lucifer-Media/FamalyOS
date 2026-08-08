-- Family OS — Итерация 2 (доп.): field-level confidence, переобработка,
-- обнаружение дублей, связь документа с несколькими людьми (для детей).

-- CreateTable: документ <-> человек, много-ко-многим (помимо основного ownerPersonId)
CREATE TABLE "entity_person_links" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "relationRole" TEXT NOT NULL DEFAULT 'subject',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,
    CONSTRAINT "entity_person_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "entity_person_links_entityId_personId_relationRole_key" ON "entity_person_links"("entityId", "personId", "relationRole");
CREATE INDEX "entity_person_links_personId_idx" ON "entity_person_links"("personId");
ALTER TABLE "entity_person_links" ADD CONSTRAINT "entity_person_links_entityId_fkey"
  FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entity_person_links" ADD CONSTRAINT "entity_person_links_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: document_intakes — confidence по полям, переобработка, дубликаты
ALTER TABLE "document_intakes" ADD COLUMN "suggestedFieldConfidence" JSONB;
ALTER TABLE "document_intakes" ADD COLUMN "targetEntityId" TEXT;
ALTER TABLE "document_intakes" ADD COLUMN "possibleDuplicateOfEntityId" TEXT;
ALTER TABLE "document_intakes" ADD CONSTRAINT "document_intakes_targetEntityId_fkey"
  FOREIGN KEY ("targetEntityId") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
