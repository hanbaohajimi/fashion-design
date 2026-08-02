CREATE TYPE "FabricScope" AS ENUM ('preset', 'user');

CREATE TABLE "fabrics" (
  "id" TEXT NOT NULL,
  "scope" "FabricScope" NOT NULL,
  "owner_id" TEXT,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "sub_category" TEXT,
  "main_file_id" TEXT NOT NULL,
  "attributes" JSONB NOT NULL,
  "ai_tags" JSONB,
  "source" TEXT,
  "license" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fabrics_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fabrics_scope_owner_check" CHECK (
    ("scope" = 'preset' AND "owner_id" IS NULL)
    OR ("scope" = 'user' AND "owner_id" IS NOT NULL)
  )
);

CREATE INDEX "fabrics_scope_category_idx"
ON "fabrics"("scope", "category");

CREATE INDEX "fabrics_owner_id_idx"
ON "fabrics"("owner_id");

ALTER TABLE "fabrics"
ADD CONSTRAINT "fabrics_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fabrics"
ADD CONSTRAINT "fabrics_main_file_id_fkey"
FOREIGN KEY ("main_file_id") REFERENCES "file_assets"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
