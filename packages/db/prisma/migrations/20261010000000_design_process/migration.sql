CREATE TABLE "design_steps" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "generation_task_id" TEXT,
  "output_asset_id" TEXT,
  "tool" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "intent" TEXT NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "design_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "design_steps_output_check" CHECK (num_nonnulls("generation_task_id", "output_asset_id") = 1)
);
CREATE UNIQUE INDEX "design_steps_generation_task_id_key" ON "design_steps"("generation_task_id");
CREATE UNIQUE INDEX "design_steps_output_asset_id_key" ON "design_steps"("output_asset_id");
CREATE INDEX "design_steps_project_id_created_at_idx" ON "design_steps"("project_id", "created_at");
ALTER TABLE "design_steps" ADD CONSTRAINT "design_steps_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "design_steps" ADD CONSTRAINT "design_steps_generation_task_id_fkey" FOREIGN KEY ("generation_task_id") REFERENCES "generation_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "design_steps" ADD CONSTRAINT "design_steps_output_asset_id_fkey" FOREIGN KEY ("output_asset_id") REFERENCES "design_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "design_asset_decisions" (
  "id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "client_request_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "design_asset_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "design_asset_decisions_kind_check" CHECK ("kind" IN ('selected', 'rejected', 'compare'))
);
CREATE UNIQUE INDEX "design_asset_decisions_asset_id_client_request_id_key" ON "design_asset_decisions"("asset_id", "client_request_id");
CREATE INDEX "design_asset_decisions_asset_id_created_at_idx" ON "design_asset_decisions"("asset_id", "created_at");
ALTER TABLE "design_asset_decisions" ADD CONSTRAINT "design_asset_decisions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "design_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "design_asset_decisions" ADD CONSTRAINT "design_asset_decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
