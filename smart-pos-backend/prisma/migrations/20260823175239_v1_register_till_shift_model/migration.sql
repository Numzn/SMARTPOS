-- CreateEnum
CREATE TYPE "CashDeclarationType" AS ENUM ('OPENING', 'HANDOVER', 'CLOSING');

-- DropForeignKey
ALTER TABLE "cashier_declarations" DROP CONSTRAINT "cashier_declarations_zReportId_fkey";

-- DropIndex
DROP INDEX "cashier_declarations_shiftId_key";

-- AlterTable
ALTER TABLE "cashier_declarations" ADD COLUMN     "type" "CashDeclarationType" NOT NULL DEFAULT 'CLOSING',
ALTER COLUMN "zReportId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "registerId" TEXT,
ADD COLUMN     "tillId" TEXT;

-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "tillId" TEXT;

-- CreateTable
CREATE TABLE "registers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tills" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registerId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "defaultOpeningFloat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_cashiers" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "shift_cashiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registers_code_key" ON "registers"("code");

-- CreateIndex
CREATE INDEX "registers_branchId_idx" ON "registers"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "tills_code_key" ON "tills"("code");

-- CreateIndex
CREATE INDEX "tills_registerId_idx" ON "tills"("registerId");

-- CreateIndex
CREATE INDEX "shift_cashiers_shiftId_idx" ON "shift_cashiers"("shiftId");

-- CreateIndex
CREATE INDEX "shift_cashiers_userId_idx" ON "shift_cashiers"("userId");

-- CreateIndex
CREATE INDEX "cashier_declarations_shiftId_idx" ON "cashier_declarations"("shiftId");

-- CreateIndex
CREATE INDEX "sales_registerId_idx" ON "sales"("registerId");

-- CreateIndex
CREATE INDEX "sales_tillId_idx" ON "sales"("tillId");

-- CreateIndex
CREATE INDEX "shifts_tillId_status_idx" ON "shifts"("tillId", "status");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tillId_fkey" FOREIGN KEY ("tillId") REFERENCES "tills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registers" ADD CONSTRAINT "registers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tills" ADD CONSTRAINT "tills_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tillId_fkey" FOREIGN KEY ("tillId") REFERENCES "tills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_cashiers" ADD CONSTRAINT "shift_cashiers_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_cashiers" ADD CONSTRAINT "shift_cashiers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_declarations" ADD CONSTRAINT "cashier_declarations_zReportId_fkey" FOREIGN KEY ("zReportId") REFERENCES "z_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique indexes with no schema.prisma representation (Prisma has no
-- filtered/WHERE unique constraint syntax) — same pattern as the pre-existing
-- shifts_active_user_branch_key index (see the comment on the Shift model).
-- Because these have no schema.prisma representation, they are invisible to
-- `prisma db push` and to any future migration-history baseline reset — if
-- you ever reset migration history, both must be re-added by hand. A test
-- asserts their existence via pg_indexes so a silent drop fails CI instead
-- of surfacing live.

-- At most one OPENING declaration per shift.
CREATE UNIQUE INDEX "cashier_declarations_one_opening_per_shift" ON "cashier_declarations" ("shiftId") WHERE "type" = 'OPENING';

-- At most one CLOSING declaration per shift — this is the constraint the
-- original plain `shiftId @unique` used to provide, now scoped by type since
-- HANDOVER declarations can be many per shift.
CREATE UNIQUE INDEX "cashier_declarations_one_closing_per_shift" ON "cashier_declarations" ("shiftId") WHERE "type" = 'CLOSING';

-- At most one ShiftCashier row with no endedAt (i.e. "currently operating
-- this shift") at a time, per shift — the invariant handoverShift()/endShift()
-- in lib/shift.js depend on to know who the shift's current cashier is.
CREATE UNIQUE INDEX "shift_cashiers_one_active_per_shift" ON "shift_cashiers" ("shiftId") WHERE "endedAt" IS NULL;
