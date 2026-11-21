-- CreateIndex
CREATE INDEX "fuel_transactions_attendantId_transactionTime_idx" ON "fuel_transactions"("attendantId", "transactionTime");
