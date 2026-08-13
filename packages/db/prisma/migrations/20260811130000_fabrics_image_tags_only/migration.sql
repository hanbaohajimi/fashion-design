-- The fabric library now treats the image and tags as its only business data.
-- Preserve existing AI tags where possible; otherwise convert the old name
-- into a single tag before permanently dropping the legacy columns.
ALTER TABLE "fabrics"
ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "fabrics" AS "fabric"
SET "tags" = CASE
  WHEN jsonb_typeof("fabric"."ai_tags") = 'array'
    AND jsonb_array_length("fabric"."ai_tags") > 0
  THEN ARRAY(
    SELECT jsonb_array_elements_text("fabric"."ai_tags")
  )
  WHEN btrim("fabric"."name") <> ''
  THEN ARRAY[left(btrim("fabric"."name"), 30)]
  ELSE ARRAY['面料']
END;

ALTER TABLE "generation_inputs"
ADD COLUMN "tags_snapshot" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "generation_inputs" AS "generation_input"
SET "tags_snapshot" = "fabric"."tags"
FROM "fabrics" AS "fabric"
WHERE "generation_input"."fabric_id" = "fabric"."id";

ALTER TABLE "generation_inputs"
  DROP COLUMN "attributes_snapshot",
  ALTER COLUMN "tags_snapshot" DROP DEFAULT;

DROP INDEX IF EXISTS "fabrics_scope_category_idx";

ALTER TABLE "fabrics"
  DROP COLUMN "name",
  DROP COLUMN "category",
  DROP COLUMN "sub_category",
  DROP COLUMN "attributes",
  DROP COLUMN "ai_tags",
  DROP COLUMN "source",
  DROP COLUMN "license",
  ALTER COLUMN "tags" DROP DEFAULT,
  ADD CONSTRAINT "fabrics_tags_not_empty" CHECK (cardinality("tags") > 0);

CREATE INDEX "fabrics_scope_idx" ON "fabrics"("scope");
CREATE INDEX "fabrics_tags_idx" ON "fabrics" USING GIN ("tags");
