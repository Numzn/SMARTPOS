-- CreateEnum
CREATE TYPE "FuelOperationalStatus" AS ENUM ('DISPENSED');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'FISCALIZED', 'FAILED', 'SUMMARY_PENDING', 'SUMMARY_FISCALIZED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('UNSETTLED', 'PARTIALLY_SETTLED', 'SETTLED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('B2B', 'B2C');

-- CreateEnum
CREATE TYPE "AttendantStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "PumpStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "FiscalRecordScope" AS ENUM ('TRANSACTION', 'SUMMARY');

-- CreateEnum
CREATE TYPE "SettlementBatchStatus" AS ENUM ('OPEN', 'CONFIRMED', 'EXCEPTION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'MOBILE_MONEY';
ALTER TYPE "PaymentMethod" ADD VALUE 'ACCOUNT_CREDIT';
ALTER TYPE "PaymentMethod" ADD VALUE 'MIXED';

-- CreateTable
CREATE TABLE "pumps" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'main',
    "code" TEXT NOT NULL,
    "name" TEXT,
    "status" "PumpStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pumps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendants" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'main',
    "name" TEXT NOT NULL,
    "attendantCode" TEXT NOT NULL,
    "status" "AttendantStatus" NOT NULL DEFAULT 'ACTIVE',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_records" (
    "id" TEXT NOT NULL,
    "scope" "FiscalRecordScope" NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'main',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "amount" DOUBLE PRECISION NOT NULL,
    "taxAmount" DOUBLE PRECISION,
    "rcptNo" TEXT,
    "rcptSign" TEXT,
    "qrCode" TEXT,
    "vsdcRequest" JSONB,
    "vsdcResponse" JSONB,
    "fiscalInvcNo" INTEGER,
    "fiscalError" TEXT,
    "fiscalErrorCode" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2c_summary_pools" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'main',
    "shiftId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "transactionCount" INTEGER,
    "totalAmount" DOUBLE PRECISION,
    "fiscalRecordId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "b2c_summary_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_transactions" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'main',
    "pumpId" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shiftId" TEXT,
    "volume" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "taxRate" DOUBLE PRECISION,
    "vatCategoryCode" TEXT,
    "transactionTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operationalStatus" "FuelOperationalStatus" NOT NULL DEFAULT 'DISPENSED',
    "customerId" TEXT,
    "customerType" "CustomerType" NOT NULL DEFAULT 'B2C',
    "invoiceRequested" BOOLEAN NOT NULL DEFAULT false,
    "fiscalStatus" "FiscalStatus" NOT NULL DEFAULT 'PENDING',
    "fiscalRecordId" TEXT,
    "summaryPoolId" TEXT,
    "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'UNSETTLED',
    "settlementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendant_settlements" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "shiftId" TEXT,
    "expectedAmount" DOUBLE PRECISION,
    "declaredAmount" DOUBLE PRECISION,
    "variance" DOUBLE PRECISION,
    "status" "SettlementStatus" NOT NULL DEFAULT 'UNSETTLED',
    "settledByUserId" TEXT,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendant_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_batches" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'main',
    "shiftId" TEXT,
    "status" "SettlementBatchStatus" NOT NULL DEFAULT 'OPEN',
    "initiatedByUserId" TEXT NOT NULL,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pumps_code_key" ON "pumps"("code");

-- CreateIndex
CREATE INDEX "pumps_branchId_status_idx" ON "pumps"("branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendants_attendantCode_key" ON "attendants"("attendantCode");

-- CreateIndex
CREATE UNIQUE INDEX "attendants_userId_key" ON "attendants"("userId");

-- CreateIndex
CREATE INDEX "attendants_branchId_status_idx" ON "attendants"("branchId", "status");

-- CreateIndex
CREATE INDEX "fiscal_records_branchId_idx" ON "fiscal_records"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "b2c_summary_pools_fiscalRecordId_key" ON "b2c_summary_pools"("fiscalRecordId");

-- CreateIndex
CREATE INDEX "b2c_summary_pools_branchId_status_idx" ON "b2c_summary_pools"("branchId", "status");

-- CreateIndex
CREATE INDEX "fuel_transactions_branchId_transactionTime_idx" ON "fuel_transactions"("branchId", "transactionTime");

-- CreateIndex
CREATE INDEX "fuel_transactions_pumpId_transactionTime_idx" ON "fuel_transactions"("pumpId", "transactionTime");

-- CreateIndex
CREATE INDEX "fuel_transactions_attendantId_settlementStatus_idx" ON "fuel_transactions"("attendantId", "settlementStatus");

-- CreateIndex
CREATE INDEX "fuel_transactions_shiftId_idx" ON "fuel_transactions"("shiftId");

-- CreateIndex
CREATE INDEX "fuel_transactions_fiscalStatus_idx" ON "fuel_transactions"("fiscalStatus");

-- CreateIndex
CREATE INDEX "fuel_transactions_settlementStatus_idx" ON "fuel_transactions"("settlementStatus");

-- CreateIndex
CREATE INDEX "attendant_settlements_batchId_idx" ON "attendant_settlements"("batchId");

-- CreateIndex
CREATE INDEX "attendant_settlements_attendantId_status_idx" ON "attendant_settlements"("attendantId", "status");

-- CreateIndex
CREATE INDEX "settlement_batches_branchId_status_idx" ON "settlement_batches"("branchId", "status");

-- CreateIndex
CREATE INDEX "settlement_batches_shiftId_idx" ON "settlement_batches"("shiftId");

-- AddForeignKey
ALTER TABLE "pumps" ADD CONSTRAINT "pumps_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendants" ADD CONSTRAINT "attendants_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendants" ADD CONSTRAINT "attendants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2c_summary_pools" ADD CONSTRAINT "b2c_summary_pools_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2c_summary_pools" ADD CONSTRAINT "b2c_summary_pools_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2c_summary_pools" ADD CONSTRAINT "b2c_summary_pools_fiscalRecordId_fkey" FOREIGN KEY ("fiscalRecordId") REFERENCES "fiscal_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "pumps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "attendants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_fiscalRecordId_fkey" FOREIGN KEY ("fiscalRecordId") REFERENCES "fiscal_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_summaryPoolId_fkey" FOREIGN KEY ("summaryPoolId") REFERENCES "b2c_summary_pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_transactions" ADD CONSTRAINT "fuel_transactions_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "attendant_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendant_settlements" ADD CONSTRAINT "attendant_settlements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendant_settlements" ADD CONSTRAINT "attendant_settlements_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "attendants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendant_settlements" ADD CONSTRAINT "attendant_settlements_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendant_settlements" ADD CONSTRAINT "attendant_settlements_settledByUserId_fkey" FOREIGN KEY ("settledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_batches" ADD CONSTRAINT "settlement_batches_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
