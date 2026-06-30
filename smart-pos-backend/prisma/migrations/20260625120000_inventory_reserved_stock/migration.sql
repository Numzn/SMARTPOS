-- Reserve stock during fiscal submission (VSDC before deduct pattern)

ALTER TABLE "inventory" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
