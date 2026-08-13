-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'IMPORT_IN';

-- CreateEnum
CREATE TYPE "ImportItemDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "import_retrieval_cursors" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "lastReqDt" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "lastImportedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_retrieval_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieved_import_items" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT 'main',
    "taskCd" TEXT NOT NULL,
    "dclDe" TEXT,
    "itemSeq" INTEGER NOT NULL,
    "dclNo" TEXT,
    "hsCd" TEXT,
    "itemNm" TEXT,
    "imptItemSttsCd" TEXT,
    "orgnNatCd" TEXT,
    "exptNatCd" TEXT,
    "pkg" DOUBLE PRECISION,
    "pkgUnitCd" TEXT,
    "qty" DOUBLE PRECISION,
    "qtyUnitCd" TEXT,
    "totWt" DOUBLE PRECISION,
    "netWt" DOUBLE PRECISION,
    "spplrNm" TEXT,
    "agntNm" TEXT,
    "invcFcurAmt" DOUBLE PRECISION,
    "invcFcurCd" TEXT,
    "invcFcurExcrt" DOUBLE PRECISION,
    "dclRefNum" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "ImportItemDecision" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decidedProductId" TEXT,
    "remark" TEXT,
    "zraDecisionSyncedAt" TIMESTAMP(3),
    "zraDecisionSyncError" TEXT,
    "zraDecisionSyncResponse" JSONB,

    CONSTRAINT "retrieved_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "import_retrieval_cursors_branchId_key" ON "import_retrieval_cursors"("branchId");

-- CreateIndex
CREATE INDEX "retrieved_import_items_branchId_idx" ON "retrieved_import_items"("branchId");

-- CreateIndex
CREATE INDEX "retrieved_import_items_decision_idx" ON "retrieved_import_items"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "retrieved_import_items_taskCd_itemSeq_key" ON "retrieved_import_items"("taskCd", "itemSeq");

-- AddForeignKey
ALTER TABLE "retrieved_import_items" ADD CONSTRAINT "retrieved_import_items_decidedProductId_fkey" FOREIGN KEY ("decidedProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
