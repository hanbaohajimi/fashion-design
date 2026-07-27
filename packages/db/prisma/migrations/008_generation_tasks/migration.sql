CREATE TYPE "GenerationTaskStatus" AS ENUM (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED'
);

CREATE TABLE "generation_tasks" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "status" "GenerationTaskStatus" NOT NULL DEFAULT 'QUEUED',
  "task_type" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "provider_job" JSONB,
  "output" JSONB,
  "error_code" TEXT,
  "error_message" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "counted_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "canceled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "generation_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generation_tasks_user_id_created_at_idx"
ON "generation_tasks"("user_id", "created_at");

CREATE INDEX "generation_tasks_status_created_at_idx"
ON "generation_tasks"("status", "created_at");

ALTER TABLE "generation_tasks"
ADD CONSTRAINT "generation_tasks_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
