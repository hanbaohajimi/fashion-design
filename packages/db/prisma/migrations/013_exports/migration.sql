CREATE TYPE "AccountPlan" AS ENUM ('FREE', 'PRO');
CREATE TYPE "ExportFormat" AS ENUM ('PNG', 'JPG', 'PDF');
CREATE TYPE "ExportQuality" AS ENUM ('STANDARD', 'HIGH');
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

ALTER TABLE "users"
ADD COLUMN "plan" "AccountPlan" NOT NULL DEFAULT 'FREE';

CREATE TABLE "export_jobs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "design_asset_id" TEXT,
  "collection_id" TEXT,
  "format" "ExportFormat" NOT NULL,
  "quality" "ExportQuality" NOT NULL,
  "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
  "watermark" BOOLEAN NOT NULL,
  "max_edge" INTEGER,
  "object_key" TEXT,
  "mime_type" TEXT,
  "file_name" TEXT,
  "size_bytes" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "export_jobs_source_check" CHECK (
    ("design_asset_id" IS NOT NULL AND "collection_id" IS NULL AND "format" IN ('PNG', 'JPG'))
    OR
    ("design_asset_id" IS NULL AND "collection_id" IS NOT NULL AND "format" = 'PDF')
  ),
  CONSTRAINT "export_jobs_max_edge_check" CHECK ("max_edge" IS NULL OR "max_edge" > 0)
);

CREATE UNIQUE INDEX "export_jobs_object_key_key" ON "export_jobs"("object_key");
CREATE INDEX "export_jobs_user_id_created_at_idx" ON "export_jobs"("user_id", "created_at");
CREATE INDEX "export_jobs_status_expires_at_idx" ON "export_jobs"("status", "expires_at");
CREATE INDEX "export_jobs_design_asset_id_idx" ON "export_jobs"("design_asset_id");
CREATE INDEX "export_jobs_collection_id_idx" ON "export_jobs"("collection_id");

ALTER TABLE "export_jobs"
ADD CONSTRAINT "export_jobs_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "export_jobs"
ADD CONSTRAINT "export_jobs_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "export_jobs"
ADD CONSTRAINT "export_jobs_design_asset_id_fkey"
FOREIGN KEY ("design_asset_id") REFERENCES "design_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "export_jobs"
ADD CONSTRAINT "export_jobs_collection_id_fkey"
FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
