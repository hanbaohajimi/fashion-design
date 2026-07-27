-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "file_assets" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "thumbnail_256_key" TEXT,
    "thumbnail_1024_key" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "error_message" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_object_key_key"
ON "file_assets"("object_key");

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_owner_id_sha256_key"
ON "file_assets"("owner_id", "sha256");

-- CreateIndex
CREATE INDEX "file_assets_owner_id_status_idx"
ON "file_assets"("owner_id", "status");

-- AddForeignKey
ALTER TABLE "file_assets"
ADD CONSTRAINT "file_assets_owner_id_fkey"
FOREIGN KEY ("owner_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
