CREATE TYPE "AssistantDelegationCadence" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "AssistantDelegationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "assistant_delegations" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "request_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "prompt" TEXT NOT NULL,
  "cadence" "AssistantDelegationCadence" NOT NULL,
  "status" "AssistantDelegationStatus" NOT NULL DEFAULT 'ACTIVE',
  "next_run_at" TIMESTAMP(3) NOT NULL,
  "last_run_at" TIMESTAMP(3),
  "last_error" TEXT,
  "run_count" INTEGER NOT NULL DEFAULT 0,
  "time_zone" VARCHAR(80) NOT NULL DEFAULT 'Asia/Shanghai',
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "assistant_delegations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_delegations_owner_id_request_key_key"
  ON "assistant_delegations"("owner_id", "request_key");
CREATE INDEX "assistant_delegations_status_next_run_at_idx"
  ON "assistant_delegations"("status", "next_run_at");
CREATE INDEX "assistant_delegations_project_id_updated_at_idx"
  ON "assistant_delegations"("project_id", "updated_at");
CREATE INDEX "assistant_delegations_conversation_id_updated_at_idx"
  ON "assistant_delegations"("conversation_id", "updated_at");

ALTER TABLE "assistant_delegations"
  ADD CONSTRAINT "assistant_delegations_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_delegations"
  ADD CONSTRAINT "assistant_delegations_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_delegations"
  ADD CONSTRAINT "assistant_delegations_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
