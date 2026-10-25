ALTER TYPE "DesignAssetOperation" ADD VALUE 'TRANSFORM';
ALTER TYPE "DesignAssetOperation" ADD VALUE 'REMOVE_BACKGROUND';
ALTER TYPE "DesignAssetOperation" ADD VALUE 'ERASE';
ALTER TYPE "DesignAssetOperation" ADD VALUE 'OUTPAINT';
CREATE TABLE "image_asset_feedback" (
  "asset_id" TEXT PRIMARY KEY REFERENCES "design_assets"("id") ON DELETE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 0, "data" JSONB NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "image_asset_shares" (
  "id" TEXT PRIMARY KEY, "asset_id" TEXT NOT NULL REFERENCES "design_assets"("id") ON DELETE CASCADE,
  "token_hash" TEXT NOT NULL UNIQUE, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL, "revoked_at" TIMESTAMP(3)
);
CREATE INDEX "image_asset_shares_asset_id_idx" ON "image_asset_shares"("asset_id");
CREATE TABLE "image_transform_results" ("attempt_id" TEXT PRIMARY KEY, "asset_id" TEXT, "error" TEXT);
