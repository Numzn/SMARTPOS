-- Preserves the ZRA resultCd (e.g. "007" duplicate invoice) alongside the
-- human-readable fiscalError message, which previously discarded it. Needed
-- so a failed submission can be told apart from a duplicate-invoice retry
-- once the resultCd is available to check against.

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "fiscalErrorCode" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "fiscalErrorCode" TEXT;
