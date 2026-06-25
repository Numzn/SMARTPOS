-- Sequential VSDC invoice numbers (real ZRA; replaces CUID-based invcNo)

ALTER TABLE "vsdc_devices" ADD COLUMN IF NOT EXISTS "lastInvcNo" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "fiscalInvcNo" INTEGER;

ALTER TABLE "refunds" ADD COLUMN IF NOT EXISTS "fiscalInvcNo" INTEGER;
