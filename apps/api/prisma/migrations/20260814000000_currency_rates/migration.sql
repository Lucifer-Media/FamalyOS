-- Family OS — справочник курсов валют.

CREATE TABLE "currency_rates" (
    "id" TEXT NOT NULL,
    "familySpaceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    CONSTRAINT "currency_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "currency_rates_date_fromCurrency_toCurrency_key" ON "currency_rates"("date", "fromCurrency", "toCurrency");
CREATE INDEX "currency_rates_familySpaceId_date_idx" ON "currency_rates"("familySpaceId", "date");
CREATE INDEX "currency_rates_fromCurrency_toCurrency_date_idx" ON "currency_rates"("fromCurrency", "toCurrency", "date");

ALTER TABLE "currency_rates" ADD CONSTRAINT "currency_rates_familySpaceId_fkey"
  FOREIGN KEY ("familySpaceId") REFERENCES "family_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
