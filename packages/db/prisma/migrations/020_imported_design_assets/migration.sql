ALTER TYPE "DesignAssetOperation" ADD VALUE 'IMPORTED';

ALTER TABLE "design_assets"
ADD COLUMN "source_file_id" TEXT;

CREATE INDEX "design_assets_source_file_id_idx"
ON "design_assets"("source_file_id");

CREATE UNIQUE INDEX "design_assets_project_id_source_file_id_key"
ON "design_assets"("project_id", "source_file_id");

ALTER TABLE "design_assets"
ADD CONSTRAINT "design_assets_source_file_id_fkey"
FOREIGN KEY ("source_file_id") REFERENCES "file_assets"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
