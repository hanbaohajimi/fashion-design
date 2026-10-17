import { PrismaPg } from "@prisma/adapter-pg";

import {
  AccountPlan,
  AgentMessageRole,
  AgentMessageStatus,
  CollectionVariationAxis,
  ContentModerationStatus,
  DesignAssetOperation,
  DnaExtractionStatus,
  ExportFormat,
  ExportQuality,
  ExportStatus,
  FileStatus,
  FabricScope,
  GenerationTaskStatus,
  Prisma,
  PrismaClient,
  RoleInferenceState,
  RoleSource,
  SimilarityAnalysisStatus,
  type DesignAsset,
  type DesignAssetDecision,
  type DesignStep,
  type AgentConversation,
  type AgentMessage,
  type AgentRun,
  type AgentRunStep,
  type AgentRunStepAttempt,
  type Collection,
  type CollectionDna,
  type FileAsset,
  type Fabric,
  type ExportJob,
  type GenerationTask,
  type GenerationInput,
  type Project,
  type TrendDigest,
  type TrendItem,
  type User,
  type Workspace,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowMutation,
  type WorkflowProposal,
  type WorkflowAttempt,
  type WorkflowNodeVersion,
  type WorkflowExecution,
  type WorkflowOutbox,
  type AgentTurn,
  type AgentPlanRevision,
} from "../generated/prisma/client.js";

const globalForPrisma = globalThis as typeof globalThis & {
  fashionPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL 未配置。请复制 .env.example 为 .env 并填写 PostgreSQL 连接信息。",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

export const prisma = globalForPrisma.fashionPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.fashionPrisma = prisma;
}

export {
  AccountPlan,
  AgentMessageRole,
  AgentMessageStatus,
  CollectionVariationAxis,
  ContentModerationStatus,
  DesignAssetOperation,
  DnaExtractionStatus,
  ExportFormat,
  ExportQuality,
  ExportStatus,
  FileStatus,
  FabricScope,
  GenerationTaskStatus,
  Prisma,
  PrismaClient,
  RoleInferenceState,
  RoleSource,
  SimilarityAnalysisStatus,
};
export type {
  AgentRun,
  AgentRunStep,
  AgentRunStepAttempt,
  AgentConversation,
  AgentMessage,
  Collection,
  CollectionDna,
  DesignAsset,
  DesignAssetDecision,
  DesignStep,
  ExportJob,
  FileAsset,
  Fabric,
  GenerationTask,
  GenerationInput,
  Project,
  TrendDigest,
  TrendItem,
  User,
  Workspace,
  WorkflowGraph,
  WorkflowNode,
  WorkflowEdge,
  WorkflowMutation,
  WorkflowProposal,
  WorkflowAttempt,
  WorkflowNodeVersion,
  WorkflowExecution,
  WorkflowOutbox,
  AgentTurn,
  AgentPlanRevision,
};
export { appendWorkflowOutbox, appendGenerationTerminalOutbox, ensureWorkflowNodeVersions, recordWorkflowSemanticChange, workflowVersionSnapshot } from "./workflow-events.js";
export type { WorkflowVersionNode, WorkflowVersionEdge, WorkflowVersionBinding, WorkflowVersionSnapshot } from "./workflow-events.js";
