CREATE TYPE "AgentMessageRole" AS ENUM ('USER', 'ASSISTANT');
CREATE TYPE "AgentMessageStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "agent_conversations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "AgentMessageRole" NOT NULL,
    "status" "AgentMessageStatus" NOT NULL DEFAULT 'COMPLETED',
    "content" TEXT NOT NULL,
    "context" JSONB,
    "client_request_id" TEXT,
    "reply_to_id" TEXT,
    "generation_task_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_conversations_project_id_updated_at_idx"
ON "agent_conversations"("project_id", "updated_at");
CREATE INDEX "agent_conversations_created_by_id_updated_at_idx"
ON "agent_conversations"("created_by_id", "updated_at");
CREATE UNIQUE INDEX "agent_messages_reply_to_id_key" ON "agent_messages"("reply_to_id");
CREATE UNIQUE INDEX "agent_messages_generation_task_id_key" ON "agent_messages"("generation_task_id");
CREATE UNIQUE INDEX "agent_messages_conversation_id_client_request_id_key"
ON "agent_messages"("conversation_id", "client_request_id");
CREATE INDEX "agent_messages_conversation_id_created_at_idx"
ON "agent_messages"("conversation_id", "created_at");
CREATE INDEX "agent_messages_status_updated_at_idx"
ON "agent_messages"("status", "updated_at");

ALTER TABLE "agent_conversations"
ADD CONSTRAINT "agent_conversations_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_conversations"
ADD CONSTRAINT "agent_conversations_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_messages"
ADD CONSTRAINT "agent_messages_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_messages"
ADD CONSTRAINT "agent_messages_reply_to_id_fkey"
FOREIGN KEY ("reply_to_id") REFERENCES "agent_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_messages"
ADD CONSTRAINT "agent_messages_generation_task_id_fkey"
FOREIGN KEY ("generation_task_id") REFERENCES "generation_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
