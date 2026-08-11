-- AlterEnum
ALTER TYPE "ReceiptSourceType" ADD VALUE 'DEBIT_NOTE';

-- CreateTable
CREATE TABLE "debit_notes" (
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
    "intrlData" TEXT,
    "qrCode" TEXT,
    "vsdcTimestamp" TIMESTAMP(3),
    "vsdcRcptPbctDate" TIMESTAMP(3),
    "vsdcRequest" JSONB,
    "vsdcResponse" JSONB,
    "fiscalError" TEXT,
    "fiscalErrorCode" TEXT,
    "fiscalInvcNo" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debit_note_items" (
    "id" TEXT NOT NULL,
    "debitNoteId" TEXT NOT NULL,
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
    "itemClsCd" TEXT,
    "taxType" TEXT,

    CONSTRAINT "debit_note_items_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_originalSaleId_fkey" FOREIGN KEY ("originalSaleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_items" ADD CONSTRAINT "debit_note_items_debitNoteId_fkey" FOREIGN KEY ("debitNoteId") REFERENCES "debit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debit_note_items" ADD CONSTRAINT "debit_note_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
