-- AlterTable
ALTER TABLE "agent_conversations" ADD COLUMN     "intent_epoch" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "agent_messages" ADD COLUMN     "execution_id" TEXT,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "source_event_id" TEXT,
ADD COLUMN     "turn_id" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "workflow_agent_version" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "workflow_attempts" ADD COLUMN     "execution_id" TEXT,
ADD COLUMN     "node_version_id" TEXT;

-- AlterTable
ALTER TABLE "workflow_mutations" ADD COLUMN     "actor_id" TEXT,
ADD COLUMN     "after_snapshot" JSONB,
ADD COLUMN     "base_revision" INTEGER,
ADD COLUMN     "before_snapshot" JSONB,
ADD COLUMN     "origin" TEXT NOT NULL DEFAULT 'user',
ADD COLUMN     "result_revision" INTEGER;

-- AlterTable
ALTER TABLE "workflow_proposals" ADD COLUMN     "action_fingerprint" TEXT,
ADD COLUMN     "plan_revision" INTEGER,
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "schema_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "target_node_version_id" TEXT;

-- CreateTable
CREATE TABLE "workflow_node_versions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph_revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "input_bindings" JSONB NOT NULL,
    "previous_version_id" TEXT,
    "origin" TEXT NOT NULL,
    "actor_id" TEXT,
    "mutation_id" TEXT,
    "baseline" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_node_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_executions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "tool_node_id" TEXT NOT NULL,
    "node_version_id" TEXT,
    "conversation_id" TEXT,
    "user_id" TEXT NOT NULL,
    "execution_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "expected_attempts" INTEGER NOT NULL DEFAULT 1,
    "intent_epoch" INTEGER,
    "request_snapshot" JSONB NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_outbox" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "execution_id" TEXT,
    "attempt_id" TEXT,
    "generation_task_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_turns" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'user',
    "client_request_id" TEXT,
    "source_event_id" TEXT,
    "intent_epoch" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "graph_revision" INTEGER,
    "context_revision" INTEGER,
    "summary_revision" INTEGER,
    "plan_revision" INTEGER,
    "snapshots" JSONB,
    "budget" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_plan_revisions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "turn_id" TEXT,
    "intent_epoch" INTEGER NOT NULL,
    "graph_revision" INTEGER NOT NULL,
    "context_revision" INTEGER NOT NULL,
    "plan" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_plan_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_node_versions_project_id_graph_revision_idx" ON "workflow_node_versions"("project_id", "graph_revision");

-- CreateIndex
CREATE INDEX "workflow_node_versions_node_id_created_at_idx" ON "workflow_node_versions"("node_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_node_versions_node_id_version_key" ON "workflow_node_versions"("node_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_executions_execution_key_key" ON "workflow_executions"("execution_key");

-- CreateIndex
CREATE INDEX "workflow_executions_project_id_created_at_idx" ON "workflow_executions"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_executions_status_updated_at_idx" ON "workflow_executions"("status", "updated_at");

-- CreateIndex
CREATE INDEX "workflow_executions_conversation_id_created_at_idx" ON "workflow_executions"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_outbox_event_key_key" ON "workflow_outbox"("event_key");

-- CreateIndex
CREATE INDEX "workflow_outbox_status_available_at_idx" ON "workflow_outbox"("status", "available_at");

-- CreateIndex
CREATE INDEX "workflow_outbox_execution_id_created_at_idx" ON "workflow_outbox"("execution_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_turns_source_event_id_key" ON "agent_turns"("source_event_id");

-- CreateIndex
CREATE INDEX "agent_turns_conversation_id_created_at_idx" ON "agent_turns"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_turns_status_lease_expires_at_idx" ON "agent_turns"("status", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_turns_conversation_id_client_request_id_key" ON "agent_turns"("conversation_id", "client_request_id");

-- CreateIndex
CREATE INDEX "agent_plan_revisions_project_id_created_at_idx" ON "agent_plan_revisions"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_plan_revisions_conversation_id_revision_key" ON "agent_plan_revisions"("conversation_id", "revision");

-- CreateIndex
CREATE INDEX "agent_messages_source_event_id_idx" ON "agent_messages"("source_event_id");

-- CreateIndex
CREATE INDEX "workflow_attempts_execution_id_idx" ON "workflow_attempts"("execution_id");

-- AddForeignKey
ALTER TABLE "workflow_node_versions" ADD CONSTRAINT "workflow_node_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_outbox" ADD CONSTRAINT "workflow_outbox_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_plan_revisions" ADD CONSTRAINT "agent_plan_revisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
