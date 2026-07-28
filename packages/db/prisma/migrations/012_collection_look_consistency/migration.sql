CREATE TYPE "CollectionVariationAxis" AS ENUM (
  'SILHOUETTE',
  'FABRIC',
  'COLOR',
  'DETAIL',
  'STYLING'
);

CREATE TYPE "SimilarityAnalysisStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'READY',
  'FAILED'
);

ALTER TABLE "generation_tasks"
ADD COLUMN "collection_id" TEXT,
ADD COLUMN "variation_axis" "CollectionVariationAxis";

CREATE TABLE "collection_looks" (
  "collection_id" TEXT NOT NULL,
  "design_asset_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "variation_axis" "CollectionVariationAxis",
  "similarity_score" DOUBLE PRECISION,
  "analysis_status" "SimilarityAnalysisStatus" NOT NULL DEFAULT 'PENDING',
  "warning_ignored" BOOLEAN NOT NULL DEFAULT false,
  "is_hero" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collection_looks_pkey"
    PRIMARY KEY ("collection_id", "design_asset_id")
);

CREATE TABLE "collection_look_similarities" (
  "collection_id" TEXT NOT NULL,
  "left_asset_id" TEXT NOT NULL,
  "right_asset_id" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collection_look_similarities_pkey"
    PRIMARY KEY ("collection_id", "left_asset_id", "right_asset_id"),
  CONSTRAINT "collection_look_similarities_distinct_assets"
    CHECK ("left_asset_id" < "right_asset_id"),
  CONSTRAINT "collection_look_similarities_score_range"
    CHECK ("score" >= -1 AND "score" <= 1)
);

CREATE UNIQUE INDEX "collection_looks_design_asset_id_key"
ON "collection_looks"("design_asset_id");

CREATE UNIQUE INDEX "collection_looks_collection_id_ordinal_key"
ON "collection_looks"("collection_id", "ordinal");

CREATE INDEX "collection_looks_collection_id_created_at_idx"
ON "collection_looks"("collection_id", "created_at");

CREATE INDEX "collection_look_similarities_left_asset_id_idx"
ON "collection_look_similarities"("left_asset_id");

CREATE INDEX "collection_look_similarities_right_asset_id_idx"
ON "collection_look_similarities"("right_asset_id");

CREATE INDEX "generation_tasks_collection_id_created_at_idx"
ON "generation_tasks"("collection_id", "created_at");

ALTER TABLE "generation_tasks"
ADD CONSTRAINT "generation_tasks_collection_id_fkey"
FOREIGN KEY ("collection_id") REFERENCES "collections"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "collection_looks"
ADD CONSTRAINT "collection_looks_collection_id_fkey"
FOREIGN KEY ("collection_id") REFERENCES "collections"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collection_looks"
ADD CONSTRAINT "collection_looks_design_asset_id_fkey"
FOREIGN KEY ("design_asset_id") REFERENCES "design_assets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collection_look_similarities"
ADD CONSTRAINT "collection_look_similarities_collection_id_fkey"
FOREIGN KEY ("collection_id") REFERENCES "collections"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collection_look_similarities"
ADD CONSTRAINT "collection_look_similarities_left_asset_id_fkey"
FOREIGN KEY ("left_asset_id") REFERENCES "design_assets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collection_look_similarities"
ADD CONSTRAINT "collection_look_similarities_right_asset_id_fkey"
FOREIGN KEY ("right_asset_id") REFERENCES "design_assets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "collection_looks" (
  "collection_id",
  "design_asset_id",
  "ordinal",
  "analysis_status",
  "is_hero",
  "updated_at"
)
SELECT
  "id",
  "hero_asset_id",
  1,
  'PENDING'::"SimilarityAnalysisStatus",
  true,
  CURRENT_TIMESTAMP
FROM "collections";
