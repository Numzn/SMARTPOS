-- M3 printer profiles + M4 ZRA codes cache

CREATE TYPE "PrinterType" AS ENUM ('BROWSER', 'ESCPOS_NETWORK');

CREATE TABLE "printer_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PrinterType" NOT NULL DEFAULT 'BROWSER',
    "format" TEXT NOT NULL DEFAULT 'thermal',
    "host" TEXT,
    "port" INTEGER NOT NULL DEFAULT 9100,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "branchId" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printer_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "zra_codes" (
    "id" TEXT NOT NULL,
    "codeClass" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rate" DOUBLE PRECISION,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zra_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zra_codes_codeClass_code_key" ON "zra_codes"("codeClass", "code");

CREATE TABLE "zra_classification_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zra_classification_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zra_classification_codes_code_key" ON "zra_classification_codes"("code");
