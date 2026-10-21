-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'EDITOR', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "StyleStatus" AS ENUM ('DESIGNING', 'REVIEW', 'APPROVED', 'SAMPLING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StudioDocumentType" AS ENUM ('BRAND_PROFILE', 'COLLECTION_SLOT', 'TECH_PACK', 'SAMPLE_ROUND', 'PRINT_PATTERN', 'COMMENT', 'REVIEW');

-- AlterTable
ALTER TABLE "fabrics" ADD COLUMN     "details" JSONB;

-- AlterTable
ALTER TABLE "export_jobs" ADD COLUMN     "studio_revision_id" TEXT;

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "styles" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "status" "StyleStatus" NOT NULL DEFAULT 'DESIGNING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "style_revisions" (
    "id" TEXT NOT NULL,
    "style_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "source_asset_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "style_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_documents" (
    "created_by_id" TEXT,
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "type" "StudioDocumentType" NOT NULL,
    "revision" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "collection_id" TEXT,
    "style_revision_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_mutations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_experiments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_asset_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "styles_project_id_updated_at_idx" ON "styles"("project_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "styles_project_id_code_key" ON "styles"("project_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "style_revisions_style_id_revision_key" ON "style_revisions"("style_id", "revision");

-- CreateIndex
CREATE INDEX "studio_documents_project_id_type_created_at_idx" ON "studio_documents"("project_id", "type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "studio_documents_document_id_revision_key" ON "studio_documents"("document_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "studio_mutations_project_id_user_id_request_key_key" ON "studio_mutations"("project_id", "user_id", "request_key");

-- CreateIndex
CREATE INDEX "studio_experiments_project_id_created_at_idx" ON "studio_experiments"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "studio_experiments_user_id_request_key_key" ON "studio_experiments"("user_id", "request_key");

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "styles" ADD CONSTRAINT "styles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_revisions" ADD CONSTRAINT "style_revisions_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "styles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_revisions" ADD CONSTRAINT "style_revisions_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "design_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "style_revisions" ADD CONSTRAINT "style_revisions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_documents" ADD CONSTRAINT "studio_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_documents" ADD CONSTRAINT "studio_documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_documents" ADD CONSTRAINT "studio_documents_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_documents" ADD CONSTRAINT "studio_documents_style_revision_id_fkey" FOREIGN KEY ("style_revision_id") REFERENCES "style_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_mutations" ADD CONSTRAINT "studio_mutations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_mutations" ADD CONSTRAINT "studio_mutations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_experiments" ADD CONSTRAINT "studio_experiments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_experiments" ADD CONSTRAINT "studio_experiments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_experiments" ADD CONSTRAINT "studio_experiments_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "design_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "studio_documents" ADD CONSTRAINT "studio_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
