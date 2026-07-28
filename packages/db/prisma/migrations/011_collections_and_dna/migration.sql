CREATE TYPE "DnaExtractionStatus" AS ENUM ('READY', 'FAILED');

CREATE TABLE "collections" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "hero_asset_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collection_dna" (
  "collection_id" TEXT NOT NULL,
  "extraction_status" "DnaExtractionStatus" NOT NULL DEFAULT 'READY',
  "palette" JSONB NOT NULL,
  "silhouettes" TEXT[] NOT NULL,
  "fabrics" TEXT[] NOT NULL,
  "mood_words" TEXT[] NOT NULL,
  "reference_file_ids" TEXT[] NOT NULL,
  "palette_locked" BOOLEAN NOT NULL DEFAULT false,
  "silhouettes_locked" BOOLEAN NOT NULL DEFAULT false,
  "fabrics_locked" BOOLEAN NOT NULL DEFAULT false,
  "mood_words_locked" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "collection_dna_pkey" PRIMARY KEY ("collection_id")
);

CREATE UNIQUE INDEX "collections_hero_asset_id_key"
ON "collections"("hero_asset_id");

CREATE INDEX "collections_project_id_created_at_idx"
ON "collections"("project_id", "created_at");

ALTER TABLE "collections"
ADD CONSTRAINT "collections_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collections"
ADD CONSTRAINT "collections_hero_asset_id_fkey"
FOREIGN KEY ("hero_asset_id") REFERENCES "design_assets"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "collection_dna"
ADD CONSTRAINT "collection_dna_collection_id_fkey"
FOREIGN KEY ("collection_id") REFERENCES "collections"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
