CREATE TABLE "trend_items" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "cover_file_id" TEXT,
    "category" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "extracted" JSONB,
    "curated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'published',

    CONSTRAINT "trend_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trend_digests" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "item_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overview" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trend_digests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trend_items_source_url_key" ON "trend_items"("source_url");
CREATE INDEX "trend_items_published_at_idx" ON "trend_items"("published_at");
CREATE INDEX "trend_items_category_idx" ON "trend_items"("category");
CREATE INDEX "trend_items_platform_idx" ON "trend_items"("platform");
CREATE INDEX "trend_items_status_idx" ON "trend_items"("status");

CREATE UNIQUE INDEX "trend_digests_period_key" ON "trend_digests"("period");
CREATE INDEX "trend_digests_period_idx" ON "trend_digests"("period");

ALTER TABLE "trend_items"
ADD CONSTRAINT "trend_items_cover_file_id_fkey"
FOREIGN KEY ("cover_file_id") REFERENCES "file_assets"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
