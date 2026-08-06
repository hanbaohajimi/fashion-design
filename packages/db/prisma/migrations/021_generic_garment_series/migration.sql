ALTER TYPE "CollectionVariationAxis" ADD VALUE IF NOT EXISTS 'GARMENT_TYPE';

ALTER TABLE "collections"
  ADD COLUMN "source_garment_type_code" TEXT,
  ADD COLUMN "source_garment_type_label" TEXT;

ALTER TABLE "collection_dna"
  ADD COLUMN "signature_details" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "generation_tasks"
  ADD COLUMN "garment_type_code" TEXT,
  ADD COLUMN "garment_type_label" TEXT,
  ADD COLUMN "slot_key" TEXT;

ALTER TABLE "collection_looks"
  ADD COLUMN "garment_type_code" TEXT,
  ADD COLUMN "garment_type_label" TEXT,
  ADD COLUMN "slot_key" TEXT;

CREATE UNIQUE INDEX "collection_looks_collection_id_slot_key_key"
  ON "collection_looks"("collection_id", "slot_key");
