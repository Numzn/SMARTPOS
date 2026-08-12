-- CreateTable
CREATE TABLE "product_compositions" (
    "id" TEXT NOT NULL,
    "parentProductId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "zraRegistrationStatus" "ZraRegistrationStatus" NOT NULL DEFAULT 'PENDING',
    "zraRegisteredAt" TIMESTAMP(3),
    "zraRegistrationError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_compositions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_compositions_parentProductId_componentProductId_key" ON "product_compositions"("parentProductId", "componentProductId");

-- AddForeignKey
ALTER TABLE "product_compositions" ADD CONSTRAINT "product_compositions_parentProductId_fkey" FOREIGN KEY ("parentProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_compositions" ADD CONSTRAINT "product_compositions_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
