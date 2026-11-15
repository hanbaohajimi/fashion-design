CREATE TABLE "asset_ratings" (
  "user_id" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "resource_id" TEXT NOT NULL,
  "rating" SMALLINT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "asset_ratings_pkey" PRIMARY KEY ("user_id", "domain", "resource_id"),
  CONSTRAINT "asset_ratings_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
  CONSTRAINT "asset_ratings_domain_check" CHECK ("domain" IN ('asset', 'file', 'runway', 'export')),
  CONSTRAINT "asset_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "asset_ratings_user_id_rating_idx" ON "asset_ratings"("user_id", "rating");
