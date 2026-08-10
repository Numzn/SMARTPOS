-- Separates VSDC "internal data" from the receipt signature. Previously
-- lib/saleFiscal.js wrote `rcptSign: zra.intrlData || zra.rcptSign`, so every
-- fiscalized sale/refund stored internal data in the signature column and
-- discarded the real signature (ZRA item 19(ix)(e) requires both, distinctly).
-- See scripts/backfill-fiscal-signatures.js to recover historical rows from
-- the retained vsdcResponse payload.

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "intrlData" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "intrlData" TEXT;
