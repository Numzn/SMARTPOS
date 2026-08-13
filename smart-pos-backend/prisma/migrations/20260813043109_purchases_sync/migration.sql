-- AlterTable
ALTER TABLE "goods_received_notes" ADD COLUMN     "zraSyncError" TEXT,
ADD COLUMN     "zraSyncResponse" JSONB,
ADD COLUMN     "zraSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "purchase_retrieval_cursors" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "lastReqDt" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastImportedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_retrieval_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieved_purchases" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'main',
    "spplrTpin" TEXT,
    "spplrNm" TEXT,
    "spplrBhfId" TEXT,
    "spplrInvcNo" TEXT,
    "rcptTyCd" TEXT,
    "pmtTyCd" TEXT,
    "cfmDt" TEXT,
    "salesDt" TEXT,
    "stockRlsDt" TEXT,
    "totItemCnt" INTEGER,
    "totTaxblAmt" DOUBLE PRECISION,
    "totTaxAmt" DOUBLE PRECISION,
    "totAmt" DOUBLE PRECISION,
    "remark" TEXT,
    "itemList" JSONB NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieved_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_retrieval_cursors_branchId_key" ON "purchase_retrieval_cursors"("branchId");

-- CreateIndex
CREATE INDEX "retrieved_purchases_branchId_idx" ON "retrieved_purchases"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "retrieved_purchases_spplrTpin_spplrBhfId_spplrInvcNo_key" ON "retrieved_purchases"("spplrTpin", "spplrBhfId", "spplrInvcNo");

-- CreateIndex
CREATE INDEX "goods_received_notes_zraSyncedAt_idx" ON "goods_received_notes"("zraSyncedAt");
