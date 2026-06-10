-- CreateEnum
CREATE TYPE "ZraRegistrationStatus" AS ENUM ('PENDING', 'REGISTERED', 'FAILED');

-- AlterTable
ALTER TABLE "products" ADD COLUMN "zraRegistrationStatus" "ZraRegistrationStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "products" ADD COLUMN "zraRegisteredAt" TIMESTAMP(3);
ALTER TABLE "products" ADD COLUMN "zraRegistrationError" TEXT;
ALTER TABLE "products" ADD COLUMN "vsdcItemResponse" JSONB;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN "zraSyncedAt" TIMESTAMP(3);
ALTER TABLE "stock_movements" ADD COLUMN "zraSyncError" TEXT;
ALTER TABLE "stock_movements" ADD COLUMN "zraSyncResponse" JSONB;
