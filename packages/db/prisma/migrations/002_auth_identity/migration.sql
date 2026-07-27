-- AlterTable
ALTER TABLE "users" ADD COLUMN "auth_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_id_key" ON "users"("auth_id");
