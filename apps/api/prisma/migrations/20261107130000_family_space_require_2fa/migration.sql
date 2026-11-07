-- Итерация 4.2: политика «Требовать 2FA от всех участников» (по умолчанию — да, как было)
ALTER TABLE "family_spaces" ADD COLUMN "requireTwoFactor" BOOLEAN NOT NULL DEFAULT true;
