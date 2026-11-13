-- WEBP joins the image formats after the enum addition in the prior migration.
ALTER TABLE "export_jobs"
DROP CONSTRAINT "export_jobs_source_check";

ALTER TABLE "export_jobs"
ADD CONSTRAINT "export_jobs_source_check" CHECK (
  ("design_asset_id" IS NULL AND "collection_id" IS NULL)
  OR
  ("design_asset_id" IS NOT NULL AND "collection_id" IS NULL AND "format" IN ('PNG', 'JPG', 'WEBP', 'PDF'))
  OR
  ("design_asset_id" IS NULL AND "collection_id" IS NOT NULL AND "format" = 'PDF')
);
