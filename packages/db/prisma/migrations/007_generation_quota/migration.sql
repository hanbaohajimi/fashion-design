ALTER TABLE "users"
ADD COLUMN "generation_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "generation_limit" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "users"
ADD CONSTRAINT "users_generation_count_nonnegative"
CHECK ("generation_count" >= 0),
ADD CONSTRAINT "users_generation_limit_nonnegative"
CHECK ("generation_limit" >= 0);
