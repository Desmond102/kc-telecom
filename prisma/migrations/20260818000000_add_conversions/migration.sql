-- Add conversion configuration, vendor requests, and credit ledger linkage.
CREATE TYPE "ConversionType" AS ENUM ('AIRTIME', 'DATA');
CREATE TYPE "ConversionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CREDITED');

CREATE TABLE "conversion_configs" (
    "id" TEXT NOT NULL,
    "type" "ConversionType" NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "minimumAmount" DECIMAL(14,2) NOT NULL,
    "maximumAmount" DECIMAL(14,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversion_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversion_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "walletTransactionId" TEXT,
    "type" "ConversionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "convertedAmount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "ConversionStatus" NOT NULL DEFAULT 'PENDING',
    "sourcePhone" TEXT,
    "rejectionReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversion_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversion_configs_type_key" ON "conversion_configs"("type");
CREATE UNIQUE INDEX "conversion_requests_walletTransactionId_key" ON "conversion_requests"("walletTransactionId");
CREATE UNIQUE INDEX "conversion_requests_reference_key" ON "conversion_requests"("reference");
CREATE INDEX "conversion_requests_userId_status_idx" ON "conversion_requests"("userId", "status");

ALTER TABLE "conversion_requests"
  ADD CONSTRAINT "conversion_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversion_requests"
  ADD CONSTRAINT "conversion_requests_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "conversion_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversion_requests"
  ADD CONSTRAINT "conversion_requests_walletTransactionId_fkey"
  FOREIGN KEY ("walletTransactionId") REFERENCES "wallet_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;