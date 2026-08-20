-- Add normalized provider outcomes and metadata for safe Airtime/Data reconciliation.
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';
ALTER TYPE "DataSubscriptionStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';

CREATE TYPE "ProviderOutcome" AS ENUM ('SUCCESS', 'REJECTED', 'PENDING', 'UNKNOWN');
CREATE TYPE "ProviderRetryability" AS ENUM ('RETRYABLE', 'NOT_RETRYABLE', 'UNKNOWN');

ALTER TABLE "wallet_transactions"
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "providerOutcome" "ProviderOutcome",
  ADD COLUMN "providerRetryability" "ProviderRetryability";

ALTER TABLE "airtime_purchases"
  ALTER COLUMN "status" SET DEFAULT 'PENDING',
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "providerReference" TEXT,
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "providerOutcome" "ProviderOutcome",
  ADD COLUMN "providerRetryability" "ProviderRetryability",
  ADD COLUMN "providerResponse" JSONB,
  ADD COLUMN "paidAt" TIMESTAMP(3);

ALTER TABLE "data_subscriptions"
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "providerOutcome" "ProviderOutcome",
  ADD COLUMN "providerRetryability" "ProviderRetryability";
