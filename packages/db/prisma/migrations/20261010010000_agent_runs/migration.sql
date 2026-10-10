CREATE TABLE "agent_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "client_request_id" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "context_snapshot" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'planning',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "agent_run_steps" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "tool" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "instruction" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "negative_prompt" TEXT NOT NULL,
  "source_asset_id" TEXT,
  "source_step_key" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "generation_task_id" TEXT,
  "selected_asset_id" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "agent_run_step_attempts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "step_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "execution_key" TEXT NOT NULL,
  "request_snapshot" JSONB NOT NULL,
  "compiled_snapshot" JSONB,
  "status" TEXT NOT NULL,
  "lease_token" TEXT NOT NULL,
  "lease_expires_at" TIMESTAMP(3) NOT NULL,
  "generation_task_id" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "agent_runs_project_id_created_at_idx" ON "agent_runs"("project_id", "created_at");
CREATE INDEX "agent_runs_conversation_id_created_at_idx" ON "agent_runs"("conversation_id", "created_at");
CREATE UNIQUE INDEX "agent_runs_conversation_id_client_request_id_key" ON "agent_runs"("conversation_id", "client_request_id");
CREATE UNIQUE INDEX "agent_run_steps_run_id_key_key" ON "agent_run_steps"("run_id", "key");
CREATE UNIQUE INDEX "agent_run_steps_run_id_ordinal_key" ON "agent_run_steps"("run_id", "ordinal");
CREATE UNIQUE INDEX "agent_run_step_attempts_execution_key_key" ON "agent_run_step_attempts"("execution_key");
CREATE UNIQUE INDEX "agent_run_step_attempts_generation_task_id_key" ON "agent_run_step_attempts"("generation_task_id");
CREATE UNIQUE INDEX "agent_run_step_attempts_step_id_ordinal_key" ON "agent_run_step_attempts"("step_id", "ordinal");
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_step_attempts" ADD CONSTRAINT "agent_run_step_attempts_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "agent_run_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_run_step_attempts" ADD CONSTRAINT "agent_run_step_attempts_generation_task_id_fkey" FOREIGN KEY ("generation_task_id") REFERENCES "generation_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
