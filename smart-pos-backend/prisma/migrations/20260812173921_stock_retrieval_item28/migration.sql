-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'RECONCILED';

-- DropForeignKey
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_userId_fkey";

-- AlterTable
ALTER TABLE "stock_movements" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "stock_retrieval_cursors" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "lastReqDt" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastImportedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_retrieval_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_retrieval_cursors_branchId_key" ON "stock_retrieval_cursors"("branchId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
