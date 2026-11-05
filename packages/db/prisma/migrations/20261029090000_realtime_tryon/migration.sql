CREATE TABLE "realtime_tryon_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "garment_asset_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "consent_version" TEXT NOT NULL,
  "model_id" TEXT NOT NULL, "sdk_version" TEXT NOT NULL,
  "usd_per_second" DECIMAL(16,6) NOT NULL, "reserved_usd" DECIMAL(16,6) NOT NULL,
  "price_verified_at" TEXT NOT NULL, "max_session_seconds" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'reserved', "risk_until" TIMESTAMP(3) NOT NULL,
  "token_expires_at" TIMESTAMP(3), "issued_at" TIMESTAMP(3), "ended_at" TIMESTAMP(3), "end_reason" TEXT,
  "observation_sequence" INTEGER NOT NULL DEFAULT 0, "generation_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "observation" JSONB, "observation_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "realtime_tryon_sessions_user_id_request_key_key" ON "realtime_tryon_sessions"("user_id", "request_key");
CREATE INDEX "realtime_tryon_sessions_risk_until_idx" ON "realtime_tryon_sessions"("risk_until");
CREATE INDEX "realtime_tryon_sessions_user_id_risk_until_idx" ON "realtime_tryon_sessions"("user_id", "risk_until");
CREATE INDEX "realtime_tryon_sessions_created_at_idx" ON "realtime_tryon_sessions"("created_at");
CREATE TABLE "realtime_tryon_captures" (
  "id" TEXT NOT NULL PRIMARY KEY, "session_id" TEXT NOT NULL, "request_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL, "asset_id" TEXT NOT NULL, "file_id" TEXT NOT NULL,
  "metadata" JSONB NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "realtime_tryon_captures_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "realtime_tryon_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "realtime_tryon_captures_session_id_request_key_key" ON "realtime_tryon_captures"("session_id", "request_key");
CREATE UNIQUE INDEX "realtime_tryon_captures_asset_id_key" ON "realtime_tryon_captures"("asset_id");
CREATE UNIQUE INDEX "realtime_tryon_captures_file_id_key" ON "realtime_tryon_captures"("file_id");
