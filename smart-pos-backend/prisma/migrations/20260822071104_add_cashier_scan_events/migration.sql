-- CreateTable
CREATE TABLE "cashier_scan_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "clientScanId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashier_scan_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cashier_scan_events_sessionId_clientScanId_key" ON "cashier_scan_events"("sessionId", "clientScanId");

-- AddForeignKey
ALTER TABLE "cashier_scan_events" ADD CONSTRAINT "cashier_scan_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cashier_cart_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
