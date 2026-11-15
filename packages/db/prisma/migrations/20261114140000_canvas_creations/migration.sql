CREATE TABLE "canvas_creations" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "module" TEXT NOT NULL DEFAULT 'image',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "draft" JSONB NOT NULL,
  "position" JSONB,
  "resource" JSONB,
  "current_result_node_id" TEXT,
  "removed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "canvas_creations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "canvas_creation_runs" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "creation_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "mutation_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "draft_revision" INTEGER NOT NULL,
  "draft_snapshot" JSONB NOT NULL,
  "command" JSONB NOT NULL,
  "tool_node_id" TEXT,
  "conversation_id" TEXT,
  "state" TEXT NOT NULL DEFAULT 'preparing',
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "canvas_creation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "canvas_creations_project_id_removed_at_created_at_idx" ON "canvas_creations"("project_id", "removed_at", "created_at");
CREATE UNIQUE INDEX "canvas_creation_runs_project_id_mutation_id_key" ON "canvas_creation_runs"("project_id", "mutation_id");
CREATE INDEX "canvas_creation_runs_creation_id_created_at_idx" ON "canvas_creation_runs"("creation_id", "created_at");
CREATE INDEX "canvas_creation_runs_project_id_tool_node_id_idx" ON "canvas_creation_runs"("project_id", "tool_node_id");
ALTER TABLE "canvas_creations" ADD CONSTRAINT "canvas_creations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "canvas_creation_runs" ADD CONSTRAINT "canvas_creation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "canvas_creation_runs" ADD CONSTRAINT "canvas_creation_runs_creation_id_fkey" FOREIGN KEY ("creation_id") REFERENCES "canvas_creations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
