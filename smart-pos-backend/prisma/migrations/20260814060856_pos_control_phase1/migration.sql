-- CreateEnum
CREATE TYPE "CashierCartSessionStatus" AS ENUM ('OPEN', 'CONSUMED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "CashierCartLineStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateEnum
CREATE TYPE "SupervisorActionType" AS ENUM ('LINE_REVERSAL', 'ORDER_DISCOUNT');

-- CreateEnum
CREATE TYPE "SupervisorAuthMethod" AS ENUM ('PIN', 'PASSWORD');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPERVISOR';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "pinHash" TEXT;

-- CreateTable
CREATE TABLE "cashier_cart_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "status" "CashierCartSessionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashier_cart_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashier_cart_lines" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "status" "CashierCartLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashier_cart_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervisor_approvals" (
    "id" TEXT NOT NULL,
    "approverUserId" TEXT NOT NULL,
    "actionType" "SupervisorActionType" NOT NULL,
    "sessionId" TEXT NOT NULL,
    "targetProductId" TEXT,
    "targetQuantity" INTEGER,
    "targetDiscountAmount" DOUBLE PRECISION,
    "authMethod" "SupervisorAuthMethod" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisor_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cashier_cart_lines_sessionId_productId_key" ON "cashier_cart_lines"("sessionId", "productId");

-- AddForeignKey
ALTER TABLE "cashier_cart_sessions" ADD CONSTRAINT "cashier_cart_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_cart_lines" ADD CONSTRAINT "cashier_cart_lines_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "cashier_cart_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashier_cart_lines" ADD CONSTRAINT "cashier_cart_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisor_approvals" ADD CONSTRAINT "supervisor_approvals_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
