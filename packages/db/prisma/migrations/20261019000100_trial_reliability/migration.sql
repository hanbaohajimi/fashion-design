ALTER TABLE "export_jobs"
  ADD COLUMN "request_key" TEXT,
  ADD COLUMN "request_fingerprint" TEXT,
  ADD COLUMN "lease_token" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "export_jobs_user_id_request_key_key" ON "export_jobs"("user_id", "request_key");
CREATE INDEX "export_jobs_status_lease_expires_at_idx" ON "export_jobs"("status", "lease_expires_at");
