-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "discount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "discountApprovedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "sales_discountApprovedByUserId_idx" ON "sales"("discountApprovedByUserId");

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_discountApprovedByUserId_fkey" FOREIGN KEY ("discountApprovedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
