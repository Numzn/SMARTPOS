-- AlterTable
ALTER TABLE "z_reports" ADD COLUMN     "backfilled" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "supervisorApprovalId" DROP NOT NULL;
