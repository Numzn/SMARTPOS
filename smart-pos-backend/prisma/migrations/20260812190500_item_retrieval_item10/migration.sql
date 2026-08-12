-- AlterTable
ALTER TABLE "products" ADD COLUMN "zraItemSnapshot" JSONB,
ADD COLUMN "zraSnapshotSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "item_retrieval_cursors" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "lastReqDt" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastImportedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_retrieval_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "item_retrieval_cursors_branchId_key" ON "item_retrieval_cursors"("branchId");
