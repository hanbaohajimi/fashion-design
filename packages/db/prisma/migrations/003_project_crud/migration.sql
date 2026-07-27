-- AlterTable
ALTER TABLE "projects"
ADD COLUMN "deleted_at" TIMESTAMP(3),
ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "projects_ws_id_idempotency_key_key"
ON "projects"("ws_id", "idempotency_key");
