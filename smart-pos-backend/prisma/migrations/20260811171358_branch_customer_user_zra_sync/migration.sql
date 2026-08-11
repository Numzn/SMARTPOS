-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "zraBranchSnapshot" JSONB,
ADD COLUMN     "zraSnapshotSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "zraSyncError" TEXT,
ADD COLUMN     "zraSyncResponse" JSONB,
ADD COLUMN     "zraSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "zraSyncError" TEXT,
ADD COLUMN     "zraSyncResponse" JSONB,
ADD COLUMN     "zraSyncedAt" TIMESTAMP(3);
