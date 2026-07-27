CREATE TYPE "DesignAssetOperation" AS ENUM (
  'GENERATED',
  'VARIATION',
  'INPAINT',
  'UPSCALE',
  'RESTORE'
);

ALTER TABLE "generation_tasks"
ADD COLUMN "project_id" TEXT,
ADD COLUMN "parent_asset_id" TEXT;

CREATE TABLE "design_assets" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "generation_task_id" TEXT,
  "parent_asset_id" TEXT,
  "root_asset_id" TEXT NOT NULL,
  "restored_from_asset_id" TEXT,
  "operation" "DesignAssetOperation" NOT NULL,
  "url" TEXT NOT NULL,
  "thumbnail_url" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "seed" BIGINT,
  "archived_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "design_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generation_tasks_project_id_created_at_idx"
ON "generation_tasks"("project_id", "created_at");
CREATE INDEX "generation_tasks_parent_asset_id_idx"
ON "generation_tasks"("parent_asset_id");
CREATE INDEX "design_assets_project_id_created_at_idx"
ON "design_assets"("project_id", "created_at");
CREATE INDEX "design_assets_root_asset_id_created_at_idx"
ON "design_assets"("root_asset_id", "created_at");
CREATE INDEX "design_assets_parent_asset_id_idx"
ON "design_assets"("parent_asset_id");
CREATE INDEX "design_assets_generation_task_id_idx"
ON "design_assets"("generation_task_id");
CREATE INDEX "design_assets_archived_at_idx"
ON "design_assets"("archived_at");

ALTER TABLE "generation_tasks"
ADD CONSTRAINT "generation_tasks_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "design_assets"
ADD CONSTRAINT "design_assets_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "design_assets"
ADD CONSTRAINT "design_assets_generation_task_id_fkey"
FOREIGN KEY ("generation_task_id") REFERENCES "generation_tasks"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "design_assets"
ADD CONSTRAINT "design_assets_parent_asset_id_fkey"
FOREIGN KEY ("parent_asset_id") REFERENCES "design_assets"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "design_assets"
ADD CONSTRAINT "design_assets_restored_from_asset_id_fkey"
FOREIGN KEY ("restored_from_asset_id") REFERENCES "design_assets"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "generation_tasks"
ADD CONSTRAINT "generation_tasks_parent_asset_id_fkey"
FOREIGN KEY ("parent_asset_id") REFERENCES "design_assets"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
