CREATE TABLE "studio_review_reads" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "studio_document_id" TEXT NOT NULL,
  "acknowledged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "studio_review_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studio_review_reads_user_id_studio_document_id_key"
  ON "studio_review_reads"("user_id", "studio_document_id");

CREATE INDEX "studio_review_reads_project_id_user_id_acknowledged_at_idx"
  ON "studio_review_reads"("project_id", "user_id", "acknowledged_at");

ALTER TABLE "studio_review_reads"
  ADD CONSTRAINT "studio_review_reads_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "studio_review_reads"
  ADD CONSTRAINT "studio_review_reads_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "studio_review_reads"
  ADD CONSTRAINT "studio_review_reads_studio_document_id_fkey"
  FOREIGN KEY ("studio_document_id") REFERENCES "studio_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
