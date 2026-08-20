-- Add PENDING before data_subscriptions is created
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'PENDING';
