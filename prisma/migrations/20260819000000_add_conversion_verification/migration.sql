-- Add source verification metadata to conversion requests.
ALTER TABLE "conversion_requests"
  ADD COLUMN "sourceReference" TEXT,
  ADD COLUMN "verificationNote" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedById" TEXT;

CREATE INDEX "conversion_requests_verifiedById_idx" ON "conversion_requests"("verifiedById");

ALTER TABLE "conversion_requests"
  ADD CONSTRAINT "conversion_requests_verifiedById_fkey"
  FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
