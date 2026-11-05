ALTER TABLE "projects" ADD COLUMN "canvas_interaction_mode" TEXT NOT NULL DEFAULT 'node';

CREATE TABLE "canvas_documents" (
  "project_id" TEXT NOT NULL PRIMARY KEY,
  "snapshot" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "format_version" INTEGER NOT NULL DEFAULT 1,
  "initialized_from" TEXT NOT NULL,
  "source_graph_revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "canvas_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "canvas_object_bindings" (
  "project_id" TEXT NOT NULL,
  "shape_id" TEXT NOT NULL,
  "node_id" TEXT NOT NULL,
  "removed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("project_id", "shape_id"),
  CONSTRAINT "canvas_object_bindings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "canvas_object_bindings_project_id_node_id_idx" ON "canvas_object_bindings"("project_id", "node_id");

CREATE TABLE "canvas_mutations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "mutation_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "canvas_mutations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "canvas_mutations_project_id_mutation_id_key" ON "canvas_mutations"("project_id", "mutation_id");
