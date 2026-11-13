CREATE TYPE "AssistantSkillScope" AS ENUM ('PERSONAL', 'WORKSPACE');

CREATE TABLE "assistant_skills" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "workspace_id" TEXT,
  "scope" "AssistantSkillScope" NOT NULL DEFAULT 'PERSONAL',
  "request_key" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(200) NOT NULL,
  "prompt" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "assistant_skills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_skills_owner_id_request_key_key"
  ON "assistant_skills"("owner_id", "request_key");

CREATE INDEX "assistant_skills_owner_id_updated_at_idx"
  ON "assistant_skills"("owner_id", "updated_at");

CREATE INDEX "assistant_skills_workspace_id_scope_updated_at_idx"
  ON "assistant_skills"("workspace_id", "scope", "updated_at");

ALTER TABLE "assistant_skills"
  ADD CONSTRAINT "assistant_skills_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "assistant_skills"
  ADD CONSTRAINT "assistant_skills_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
