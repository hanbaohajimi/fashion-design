ALTER TABLE "agent_conversations"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "active_turn_id" TEXT,
  ADD COLUMN "active_turn_started_at" TIMESTAMP(3);

ALTER TABLE "agent_messages" ADD COLUMN "kind" TEXT, ADD COLUMN "proposal_id" TEXT;
ALTER TABLE "workflow_proposals" ADD COLUMN "conversation_id" TEXT, ADD COLUMN "context_revision" INTEGER;

CREATE TABLE "project_design_contexts" (
  "project_id" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "project_design_context_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "state" JSONB NOT NULL,
  "source_message_id" TEXT,
  "mutation_id" TEXT,
  "request_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "agent_context_summaries" (
  "conversation_id" TEXT NOT NULL PRIMARY KEY,
  "summary" JSONB NOT NULL,
  "through_message_id" TEXT,
  "graph_revision" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "focus_node_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "current_task" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "image_visual_summaries" (
  "fingerprint" TEXT NOT NULL PRIMARY KEY,
  "source_key" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "summary" JSONB,
  "error" TEXT,
  "model" TEXT NOT NULL,
  "schema_version" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "agent_messages_proposal_id_key" ON "agent_messages"("proposal_id");
CREATE INDEX "workflow_proposals_conversation_id_created_at_idx" ON "workflow_proposals"("conversation_id", "created_at");
CREATE UNIQUE INDEX "project_design_context_revisions_project_id_revision_key" ON "project_design_context_revisions"("project_id", "revision");
CREATE UNIQUE INDEX "project_design_context_revisions_project_id_mutation_id_key" ON "project_design_context_revisions"("project_id", "mutation_id");
CREATE INDEX "project_design_context_revisions_project_id_created_at_idx" ON "project_design_context_revisions"("project_id", "created_at");
CREATE INDEX "image_visual_summaries_status_updated_at_idx" ON "image_visual_summaries"("status", "updated_at");

ALTER TABLE "project_design_contexts" ADD CONSTRAINT "project_design_contexts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_design_context_revisions" ADD CONSTRAINT "project_design_context_revisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_design_context_revisions" ADD CONSTRAINT "project_design_context_revisions_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "agent_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_context_summaries" ADD CONSTRAINT "agent_context_summaries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_proposals" ADD CONSTRAINT "workflow_proposals_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "workflow_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;
