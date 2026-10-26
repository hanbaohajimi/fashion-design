CREATE TABLE "runway_shows" (
  "id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "owner_id" TEXT NOT NULL,
  "title" TEXT NOT NULL, "draft" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
  "archived" BOOLEAN NOT NULL DEFAULT false, "request_key" TEXT NOT NULL,
  "mutations" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runway_shows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runway_shows_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "runway_shows_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "runway_shows_project_id_owner_id_request_key_key" ON "runway_shows"("project_id", "owner_id", "request_key");
CREATE INDEX "runway_shows_project_id_updated_at_idx" ON "runway_shows"("project_id", "updated_at");
CREATE TABLE "runway_runs" (
  "id" TEXT NOT NULL, "show_id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED', "stage" TEXT NOT NULL DEFAULT 'prepare',
  "input_snapshot" JSONB NOT NULL, "model_snapshot" JSONB NOT NULL DEFAULT '{}', "state" JSONB NOT NULL DEFAULT '{}',
  "pending_input" JSONB, "version" INTEGER NOT NULL DEFAULT 1, "event_sequence" INTEGER NOT NULL DEFAULT 0,
  "request_key" TEXT NOT NULL, "parent_run_id" TEXT, "parent_stage" TEXT,
  "cancel_requested_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finished_at" TIMESTAMP(3),
  CONSTRAINT "runway_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runway_runs_show_id_fkey" FOREIGN KEY ("show_id") REFERENCES "runway_shows"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "runway_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "runway_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "runway_runs_show_id_user_id_request_key_key" ON "runway_runs"("show_id", "user_id", "request_key");
CREATE INDEX "runway_runs_project_id_created_at_idx" ON "runway_runs"("project_id", "created_at");
CREATE INDEX "runway_runs_status_updated_at_idx" ON "runway_runs"("status", "updated_at");
CREATE TABLE "runway_commands" (
  "id" TEXT NOT NULL, "run_id" TEXT NOT NULL, "kind" TEXT NOT NULL, "payload" JSONB NOT NULL DEFAULT '{}',
  "request_key" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED', "lease_owner" TEXT, "lease_until" TIMESTAMP(3),
  "execution_epoch" INTEGER NOT NULL DEFAULT 0, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completed_at" TIMESTAMP(3), "error_code" TEXT,
  CONSTRAINT "runway_commands_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runway_commands_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runway_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "runway_commands_run_id_request_key_key" ON "runway_commands"("run_id", "request_key");
CREATE UNIQUE INDEX "runway_commands_one_active" ON "runway_commands"("run_id") WHERE "status" IN ('QUEUED', 'RUNNING');
CREATE INDEX "runway_commands_status_lease_until_created_at_idx" ON "runway_commands"("status", "lease_until", "created_at");
CREATE TABLE "runway_step_attempts" (
  "id" TEXT NOT NULL, "run_id" TEXT NOT NULL, "operation_key" TEXT NOT NULL, "stage" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "provider" TEXT NOT NULL, "provider_job_id" TEXT,
  "provider_data" JSONB NOT NULL DEFAULT '{}', "input" JSONB NOT NULL DEFAULT '{}', "output_media_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "error_code" TEXT, "execution_epoch" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runway_step_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runway_step_attempts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runway_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "runway_step_attempts_run_id_operation_key_key" ON "runway_step_attempts"("run_id", "operation_key");
CREATE INDEX "runway_step_attempts_run_id_stage_idx" ON "runway_step_attempts"("run_id", "stage");
CREATE TABLE "runway_media" (
  "id" TEXT NOT NULL, "run_id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "object_key" TEXT NOT NULL, "mime_type" TEXT NOT NULL, "original_name" TEXT NOT NULL, "size_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL, "width" INTEGER, "height" INTEGER, "duration_ms" INTEGER, "source" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runway_media_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runway_media_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runway_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "runway_media_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "runway_media_object_key_key" ON "runway_media"("object_key");
CREATE INDEX "runway_media_run_id_kind_created_at_idx" ON "runway_media"("run_id", "kind", "created_at");
CREATE TABLE "runway_events" (
  "id" TEXT NOT NULL, "run_id" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "type" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runway_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runway_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runway_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "runway_events_run_id_sequence_key" ON "runway_events"("run_id", "sequence");
CREATE TABLE "runway_worker_heartbeats" (
  "id" TEXT NOT NULL, "mode" TEXT NOT NULL, "capabilities" JSONB NOT NULL DEFAULT '{}',
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "runway_worker_heartbeats_pkey" PRIMARY KEY ("id")
);
