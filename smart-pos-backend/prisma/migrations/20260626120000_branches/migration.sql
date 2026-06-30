-- Business branches (VSDC Section 7.1) + link sales/users to branch code

CREATE TABLE "branches" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bhfId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "managerName" TEXT,
    "managerPhone" TEXT,
    "province" TEXT,
    "district" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "zraRegistered" BOOLEAN NOT NULL DEFAULT false,
    "zraRegistrationDate" TIMESTAMP(3),
    "zraRegistrationNumber" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "deactivatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");
CREATE UNIQUE INDEX "branches_bhfId_key" ON "branches"("bhfId");

INSERT INTO "branches" (
    "id", "code", "bhfId", "name", "address", "province", "district",
    "isActive", "zraRegistered", "createdAt", "updatedAt"
) VALUES (
    'default-main-branch',
    'main',
    '000',
    'Main Branch',
    'Lusaka, Zambia',
    'Lusaka',
    'Lusaka',
    true,
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "branchId" TEXT NOT NULL DEFAULT 'main';

ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_branchId_fkey";
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_branchId_fkey";
ALTER TABLE "users"
  ADD CONSTRAINT "users_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("code")
  ON DELETE SET NULL ON UPDATE CASCADE;
