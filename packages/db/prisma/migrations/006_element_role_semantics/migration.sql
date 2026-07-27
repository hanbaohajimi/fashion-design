CREATE TYPE "RoleSource" AS ENUM ('DEFAULT', 'INFERRED', 'MANUAL');
CREATE TYPE "RoleInferenceState" AS ENUM ('NONE', 'PENDING', 'READY', 'FAILED');

ALTER TABLE "board_elements"
ADD COLUMN "role_source" "RoleSource" NOT NULL DEFAULT 'DEFAULT',
ADD COLUMN "role_confidence" DOUBLE PRECISION,
ADD COLUMN "role_label" TEXT,
ADD COLUMN "role_inference_state" "RoleInferenceState" NOT NULL DEFAULT 'NONE',
ADD COLUMN "file_asset_id" TEXT;

CREATE INDEX "board_elements_file_asset_id_idx"
ON "board_elements"("file_asset_id");

ALTER TABLE "board_elements"
ADD CONSTRAINT "board_elements_file_asset_id_fkey"
FOREIGN KEY ("file_asset_id") REFERENCES "file_assets"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
