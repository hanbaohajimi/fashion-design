-- Align the image workspace foreign keys with Prisma's update cascade behavior.
-- Replace only the constraints; keep all tables and existing rows.
BEGIN;

ALTER TABLE "image_asset_feedback"
  DROP CONSTRAINT "image_asset_feedback_asset_id_fkey";
ALTER TABLE "image_asset_feedback"
  ADD CONSTRAINT "image_asset_feedback_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "design_assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "image_asset_shares"
  DROP CONSTRAINT "image_asset_shares_asset_id_fkey";
ALTER TABLE "image_asset_shares"
  ADD CONSTRAINT "image_asset_shares_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "design_assets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
