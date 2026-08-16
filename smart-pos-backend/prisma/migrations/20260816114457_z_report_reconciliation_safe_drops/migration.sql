-- AlterEnum
ALTER TYPE "CashMovementType" ADD VALUE 'SAFE_DROP';

-- AlterEnum
ALTER TYPE "SupervisorActionType" ADD VALUE 'SHIFT_END';

-- AlterTable
ALTER TABLE "business_profiles" ADD COLUMN     "safeDropThreshold" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "shift_cash_movements" ADD COLUMN     "safeId" TEXT,
ADD COLUMN     "witnessUserId" TEXT;

-- AlterTable
ALTER TABLE "supervisor_approvals" ADD COLUMN     "targetShiftId" TEXT;

-- CreateTable
CREATE TABLE "z_reports" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "zNumber" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "cashierUserId" TEXT NOT NULL,
    "authorizedByUserId" TEXT NOT NULL,
    "supervisorApprovalId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shiftOpenedAt" TIMESTAMP(3) NOT NULL,
    "shiftEndedAt" TIMESTAMP(3) NOT NULL,
    "openingFloat" DOUBLE PRECISION NOT NULL,
    "grossSales" DOUBLE PRECISION NOT NULL,
    "discounts" DOUBLE PRECISION NOT NULL,
    "netSales" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    "refunds" DOUBLE PRECISION NOT NULL,
    "cancelledCount" INTEGER NOT NULL,
    "transactionCount" INTEGER NOT NULL,
    "salesByMethod" JSONB NOT NULL,
    "cashSales" DOUBLE PRECISION NOT NULL,
    "cashRefunds" DOUBLE PRECISION NOT NULL,
    "cashIn" DOUBLE PRECISION NOT NULL,
    "cashOut" DOUBLE PRECISION NOT NULL,
    "paidOut" DOUBLE PRECISION NOT NULL,
    "safeDrops" JSONB NOT NULL,
    "safeDropsTotal" DOUBLE PRECISION NOT NULL,
    "expectedClosingCash" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "z_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashier_declarations" (
    "id" TEXT NOT NULL,
    "zReportId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "declaredByUserId" TEXT NOT NULL,
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declaredTotal" DOUBLE PRECISION NOT NULL,
    "denominations" JSONB,

    CONSTRAINT "cashier_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_adjustments" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "zReportId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resolutionNote" TEXT NOT NULL,
    "adjustedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "z_reports_shiftId_key" ON "z_reports"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "z_reports_zNumber_key" ON "z_reports"("zNumber");

-- CreateIndex
CREATE UNIQUE INDEX "z_reports_supervisorApprovalId_key" ON "z_reports"("supervisorApprovalId");

-- CreateIndex
CREATE UNIQUE INDEX "cashier_declarations_zReportId_key" ON "cashier_declarations"("zReportId");

-- CreateIndex
CREATE UNIQUE INDEX "cashier_declarations_shiftId_key" ON "cashier_declarations"("shiftId");

-- AddForeignKey
ALTER TABLE "shift_cash_movements" ADD CONSTRAINT "shift_cash_movements_witnessUserId_fkey" FOREIGN KEY ("witnessUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "z_reports" ADD CONSTRAINT "z_reports_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "z_reports" ADD CONSTRAINT "z_reports_cashierUserId_fkey" FOREIGN KEY ("cashierUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "z_reports" ADD CONSTRAINT "z_reports_authorizedByUserId_fkey" FOREIGN KEY ("authorizedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_declarations" ADD CONSTRAINT "cashier_declarations_zReportId_fkey" FOREIGN KEY ("zReportId") REFERENCES "z_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_declarations" ADD CONSTRAINT "cashier_declarations_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_declarations" ADD CONSTRAINT "cashier_declarations_declaredByUserId_fkey" FOREIGN KEY ("declaredByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_adjustments" ADD CONSTRAINT "shift_adjustments_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_adjustments" ADD CONSTRAINT "shift_adjustments_zReportId_fkey" FOREIGN KEY ("zReportId") REFERENCES "z_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_adjustments" ADD CONSTRAINT "shift_adjustments_adjustedByUserId_fkey" FOREIGN KEY ("adjustedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
