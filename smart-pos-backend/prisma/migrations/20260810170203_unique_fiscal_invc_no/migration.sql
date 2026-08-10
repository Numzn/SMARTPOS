-- Regression guard for the atomic invoice-number counter in
-- lib/fiscalInvoiceNumber.js. Does not catch a sale and a refund colliding,
-- since they intentionally share one counter across two tables.

-- CreateIndex
CREATE UNIQUE INDEX "refunds_fiscalInvcNo_key" ON "refunds"("fiscalInvcNo");

-- CreateIndex
CREATE UNIQUE INDEX "sales_fiscalInvcNo_key" ON "sales"("fiscalInvcNo");
