-- Receipt Platform v1: Sale customer/tender, BusinessProfile, ReceiptSnapshot

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "customerTpin" TEXT;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "amountPaid" DOUBLE PRECISION;
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "changeAmount" DOUBLE PRECISION;

CREATE TYPE "ReceiptSourceType" AS ENUM ('SALE', 'CREDIT_NOTE');

CREATE TABLE IF NOT EXISTS "business_profiles" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "tradingName" TEXT NOT NULL,
    "tpin" TEXT NOT NULL,
    "logoUrl" TEXT,
    "footerLines" JSONB NOT NULL DEFAULT '[]',
    "showPoweredBy" BOOLEAN NOT NULL DEFAULT true,
    "receiptVersion" TEXT NOT NULL DEFAULT '1.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "receipt_snapshots" (
    "id" TEXT NOT NULL,
    "sourceType" "ReceiptSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "snapshot" JSONB NOT NULL,
    "reprintCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "receipt_snapshots_sourceType_sourceId_key"
    ON "receipt_snapshots"("sourceType", "sourceId");
