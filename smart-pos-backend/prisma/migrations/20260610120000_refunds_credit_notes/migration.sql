-- Refunds / credit notes (VSDC Section 5.1)

CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'FISCAL_SUBMITTING', 'COMPLETED', 'FISCAL_FAILED', 'CANCELLED');

CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "originalSaleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "reasonCode" TEXT NOT NULL DEFAULT '01',
    "reason" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION,
    "total" DOUBLE PRECISION NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "rcptNo" TEXT,
    "rcptSign" TEXT,
    "qrCode" TEXT,
    "vsdcTimestamp" TIMESTAMP(3),
    "vsdcRequest" JSONB,
    "vsdcResponse" JSONB,
    "fiscalError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refund_items" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "saleItemId" TEXT,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "pkg" INTEGER,
    "qty" INTEGER NOT NULL,
    "prc" DOUBLE PRECISION NOT NULL,
    "splyAmt" DOUBLE PRECISION NOT NULL,
    "taxblAmt" DOUBLE PRECISION NOT NULL,
    "taxAmt" DOUBLE PRECISION NOT NULL,
    "totAmt" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_originalSaleId_fkey" FOREIGN KEY ("originalSaleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "refunds_originalSaleId_idx" ON "refunds"("originalSaleId");
