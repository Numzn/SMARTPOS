-- Persists the ZRA-issued confirmation date (vsdcRcptPbctDate) and each line's
-- item classification/tax type at the time of sale/refund, both of which were
-- previously either read live from Product (drifts if the product changes
-- after the sale) or discarded entirely after being parsed from the VSDC
-- response.

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "vsdcRcptPbctDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "vsdcRcptPbctDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "itemClsCd" TEXT,
ADD COLUMN     "taxType" TEXT;

-- AlterTable
ALTER TABLE "refund_items" ADD COLUMN     "itemClsCd" TEXT,
ADD COLUMN     "taxType" TEXT;
