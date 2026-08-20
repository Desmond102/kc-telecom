-- Add the states used by the airtime and data purchase reconciliation flows.
ALTER TYPE "WalletTxType" ADD VALUE IF NOT EXISTS 'CREDIT';
