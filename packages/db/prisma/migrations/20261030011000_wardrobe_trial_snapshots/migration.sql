-- Temporary try-on snapshots retain provenance without creating a saved outfit in the library.
ALTER TABLE "wardrobe_outfits" ADD COLUMN "is_trial" BOOLEAN NOT NULL DEFAULT false;
