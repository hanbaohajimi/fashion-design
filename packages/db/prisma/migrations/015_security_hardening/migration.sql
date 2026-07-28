ALTER TYPE "GenerationTaskStatus" ADD VALUE 'MODERATION_FAILED';

CREATE TYPE "ContentModerationStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'REVIEW_REQUIRED'
);

ALTER TABLE "generation_tasks"
  ADD COLUMN "moderation_status" "ContentModerationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "moderation_categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "moderation_checked_at" TIMESTAMP(3),
  ADD COLUMN "manual_review_required" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT,
  "operation" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "resource_id" TEXT,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "status_code" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "audit_logs_user_id_created_at_idx"
  ON "audit_logs"("user_id", "created_at");

CREATE INDEX "audit_logs_resource_created_at_idx"
  ON "audit_logs"("resource", "created_at");
