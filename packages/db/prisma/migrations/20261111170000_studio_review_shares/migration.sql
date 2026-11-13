CREATE TYPE "StudioShareTarget" AS ENUM ('STYLE', 'TECH_PACK');

CREATE TABLE "studio_share_links" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "target_type" "StudioShareTarget" NOT NULL,
  "style_revision_id" TEXT,
  "studio_document_id" TEXT,
  "token_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),

  CONSTRAINT "studio_share_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studio_share_links_token_hash_key"
  ON "studio_share_links"("token_hash");

CREATE INDEX "studio_share_links_project_id_created_at_idx"
  ON "studio_share_links"("project_id", "created_at");

CREATE INDEX "studio_share_links_expires_at_idx"
  ON "studio_share_links"("expires_at");

ALTER TABLE "studio_share_links"
  ADD CONSTRAINT "studio_share_links_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "studio_share_links"
  ADD CONSTRAINT "studio_share_links_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "studio_share_links"
  ADD CONSTRAINT "studio_share_links_style_revision_id_fkey"
  FOREIGN KEY ("style_revision_id") REFERENCES "style_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "studio_share_links"
  ADD CONSTRAINT "studio_share_links_studio_document_id_fkey"
  FOREIGN KEY ("studio_document_id") REFERENCES "studio_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "studio_share_links"
  ADD CONSTRAINT "studio_share_links_target_check"
  CHECK (
    ("target_type" = 'STYLE' AND "style_revision_id" IS NOT NULL AND "studio_document_id" IS NULL)
    OR
    ("target_type" = 'TECH_PACK' AND "style_revision_id" IS NULL AND "studio_document_id" IS NOT NULL)
  );
