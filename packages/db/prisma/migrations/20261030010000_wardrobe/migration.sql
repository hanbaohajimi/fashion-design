-- AlterTable
ALTER TABLE "realtime_tryon_sessions" ADD COLUMN     "outfit_snapshot_id" TEXT;

-- CreateTable
CREATE TABLE "wardrobe_items" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wardrobe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wardrobe_revisions" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source_asset_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "style_revision_id" TEXT,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wardrobe_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wardrobe_preparations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "task_id" TEXT,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wardrobe_preparations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wardrobe_outfits" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wardrobe_outfits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wardrobe_outfit_snapshots" (
    "id" TEXT NOT NULL,
    "outfit_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "reference_asset_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wardrobe_outfit_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wardrobe_tryons" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "model_asset_id" TEXT NOT NULL,
    "task_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wardrobe_tryons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wardrobe_mutations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "request_key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wardrobe_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wardrobe_items_project_id_updated_at_idx" ON "wardrobe_items"("project_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "wardrobe_revisions_item_id_version_key" ON "wardrobe_revisions"("item_id", "version");

-- CreateIndex
CREATE INDEX "wardrobe_preparations_project_id_created_at_idx" ON "wardrobe_preparations"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wardrobe_preparations_project_id_user_id_request_key_key" ON "wardrobe_preparations"("project_id", "user_id", "request_key");

-- CreateIndex
CREATE INDEX "wardrobe_outfits_project_id_updated_at_idx" ON "wardrobe_outfits"("project_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "wardrobe_outfit_snapshots_outfit_id_version_key" ON "wardrobe_outfit_snapshots"("outfit_id", "version");

-- CreateIndex
CREATE INDEX "wardrobe_tryons_project_id_created_at_idx" ON "wardrobe_tryons"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "wardrobe_tryons_project_id_user_id_request_key_key" ON "wardrobe_tryons"("project_id", "user_id", "request_key");

-- CreateIndex
CREATE UNIQUE INDEX "wardrobe_mutations_project_id_user_id_request_key_key" ON "wardrobe_mutations"("project_id", "user_id", "request_key");

-- AddForeignKey
ALTER TABLE "wardrobe_items" ADD CONSTRAINT "wardrobe_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_revisions" ADD CONSTRAINT "wardrobe_revisions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "wardrobe_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_revisions" ADD CONSTRAINT "wardrobe_revisions_source_asset_id_fkey" FOREIGN KEY ("source_asset_id") REFERENCES "design_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_revisions" ADD CONSTRAINT "wardrobe_revisions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "design_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_revisions" ADD CONSTRAINT "wardrobe_revisions_style_revision_id_fkey" FOREIGN KEY ("style_revision_id") REFERENCES "style_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_preparations" ADD CONSTRAINT "wardrobe_preparations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_outfits" ADD CONSTRAINT "wardrobe_outfits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_outfit_snapshots" ADD CONSTRAINT "wardrobe_outfit_snapshots_outfit_id_fkey" FOREIGN KEY ("outfit_id") REFERENCES "wardrobe_outfits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_tryons" ADD CONSTRAINT "wardrobe_tryons_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_tryons" ADD CONSTRAINT "wardrobe_tryons_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "wardrobe_outfit_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wardrobe_mutations" ADD CONSTRAINT "wardrobe_mutations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
