UPDATE "runway_step_attempts" SET "output_media_ids" = ARRAY[]::TEXT[] WHERE "output_media_ids" IS NULL;
ALTER TABLE "runway_step_attempts" ALTER COLUMN "output_media_ids" SET NOT NULL;
