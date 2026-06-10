-- Fiscal lock: sale status values, VSDC payload retention, device registry

ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'FISCAL_SUBMITTING';
ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'FISCAL_FAILED';

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "vsdcRequest" JSONB;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "vsdcResponse" JSONB;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "fiscalError" TEXT;

ALTER TABLE "sales" ALTER COLUMN "status" SET DEFAULT 'PENDING';

CREATE TABLE IF NOT EXISTS "vsdc_devices" (
    "id" TEXT NOT NULL,
    "tpin" TEXT NOT NULL,
    "bhfId" TEXT NOT NULL,
    "dvcSrlNo" TEXT NOT NULL,
    "sdicId" TEXT,
    "mrcNo" TEXT,
    "intrlKey" TEXT,
    "signKey" TEXT,
    "cmcKey" TEXT,
    "initialized" BOOLEAN NOT NULL DEFAULT false,
    "initResponse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vsdc_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vsdc_devices_tpin_bhfId_dvcSrlNo_key"
    ON "vsdc_devices"("tpin", "bhfId", "dvcSrlNo");
