CREATE TABLE "workflow_graphs" (
  "project_id" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "layout_revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "workflow_nodes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ready',
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "workflow_edges" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "source_node_id" TEXT NOT NULL,
  "target_node_id" TEXT NOT NULL,
  "source_port" TEXT NOT NULL,
  "target_port" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "workflow_mutations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "mutation_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "workflow_proposals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "base_revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "diff" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "mutation_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "workflow_attempts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "tool_node_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "execution_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "request_snapshot" JSONB NOT NULL,
  "generation_task_id" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "workflow_nodes_project_id_created_at_idx" ON "workflow_nodes"("project_id", "created_at");
CREATE UNIQUE INDEX "workflow_edges_project_id_source_node_id_target_node_id_target_port_key" ON "workflow_edges"("project_id", "source_node_id", "target_node_id", "target_port");
CREATE INDEX "workflow_edges_project_id_created_at_idx" ON "workflow_edges"("project_id", "created_at");
CREATE INDEX "workflow_edges_target_node_id_idx" ON "workflow_edges"("target_node_id");
CREATE UNIQUE INDEX "workflow_mutations_project_id_mutation_id_key" ON "workflow_mutations"("project_id", "mutation_id");
CREATE INDEX "workflow_mutations_project_id_created_at_idx" ON "workflow_mutations"("project_id", "created_at");
CREATE UNIQUE INDEX "workflow_proposals_project_id_mutation_id_key" ON "workflow_proposals"("project_id", "mutation_id");
CREATE INDEX "workflow_proposals_project_id_created_at_idx" ON "workflow_proposals"("project_id", "created_at");
CREATE UNIQUE INDEX "workflow_attempts_execution_key_key" ON "workflow_attempts"("execution_key");
CREATE UNIQUE INDEX "workflow_attempts_tool_node_id_ordinal_key" ON "workflow_attempts"("tool_node_id", "ordinal");
CREATE INDEX "workflow_attempts_project_id_created_at_idx" ON "workflow_attempts"("project_id", "created_at");

ALTER TABLE "workflow_graphs" ADD CONSTRAINT "workflow_graphs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_nodes" ADD CONSTRAINT "workflow_nodes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "workflow_graphs"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "workflow_graphs"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_edges" ADD CONSTRAINT "workflow_edges_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "workflow_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_mutations" ADD CONSTRAINT "workflow_mutations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "workflow_graphs"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_proposals" ADD CONSTRAINT "workflow_proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_proposals" ADD CONSTRAINT "workflow_proposals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_attempts" ADD CONSTRAINT "workflow_attempts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_attempts" ADD CONSTRAINT "workflow_attempts_tool_node_id_fkey" FOREIGN KEY ("tool_node_id") REFERENCES "workflow_nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_attempts" ADD CONSTRAINT "workflow_attempts_generation_task_id_fkey" FOREIGN KEY ("generation_task_id") REFERENCES "generation_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
