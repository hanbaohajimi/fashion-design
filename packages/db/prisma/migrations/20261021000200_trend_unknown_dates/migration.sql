-- Preserve unknown source publication dates instead of using collection time.
ALTER TABLE "trend_items" ALTER COLUMN "published_at" DROP NOT NULL;
