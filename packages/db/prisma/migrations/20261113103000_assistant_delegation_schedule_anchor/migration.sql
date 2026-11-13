ALTER TABLE "assistant_delegations"
  ADD COLUMN "scheduled_local_day_of_month" INTEGER,
  ADD COLUMN "scheduled_local_hour" INTEGER,
  ADD COLUMN "scheduled_local_minute" INTEGER,
  ADD COLUMN "scheduled_local_second" INTEGER NOT NULL DEFAULT 0;

WITH valid_zones AS (
  SELECT
    delegation."id",
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_timezone_names
        WHERE pg_timezone_names."name" = delegation."time_zone"
      ) THEN delegation."time_zone"
      ELSE 'UTC'
    END AS zone_name
  FROM "assistant_delegations" AS delegation
)
UPDATE "assistant_delegations" AS delegation
SET
  "scheduled_local_day_of_month" = EXTRACT(
    DAY FROM ((delegation."next_run_at" AT TIME ZONE 'UTC') AT TIME ZONE valid_zones.zone_name)
  )::INTEGER,
  "scheduled_local_hour" = EXTRACT(
    HOUR FROM ((delegation."next_run_at" AT TIME ZONE 'UTC') AT TIME ZONE valid_zones.zone_name)
  )::INTEGER,
  "scheduled_local_minute" = EXTRACT(
    MINUTE FROM ((delegation."next_run_at" AT TIME ZONE 'UTC') AT TIME ZONE valid_zones.zone_name)
  )::INTEGER,
  "scheduled_local_second" = EXTRACT(
    SECOND FROM ((delegation."next_run_at" AT TIME ZONE 'UTC') AT TIME ZONE valid_zones.zone_name)
  )::INTEGER
FROM valid_zones
WHERE delegation."id" = valid_zones."id";

ALTER TABLE "assistant_delegations"
  ALTER COLUMN "scheduled_local_day_of_month" SET NOT NULL,
  ALTER COLUMN "scheduled_local_hour" SET NOT NULL,
  ALTER COLUMN "scheduled_local_minute" SET NOT NULL;
