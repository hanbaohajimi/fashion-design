import { PrismaPg } from "@prisma/adapter-pg";

import {
  AccountPlan,
  CollectionVariationAxis,
  DesignAssetOperation,
  DnaExtractionStatus,
  ExportFormat,
  ExportQuality,
  ExportStatus,
  FileStatus,
  GenerationTaskStatus,
  Prisma,
  PrismaClient,
  RoleInferenceState,
  RoleSource,
  SimilarityAnalysisStatus,
  type DesignAsset,
  type Collection,
  type CollectionDna,
  type FileAsset,
  type ExportJob,
  type GenerationTask,
  type Project,
  type User,
  type Workspace,
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
  CollectionVariationAxis,
  DesignAssetOperation,
  DnaExtractionStatus,
  ExportFormat,
  ExportQuality,
  ExportStatus,
  FileStatus,
  GenerationTaskStatus,
  Prisma,
  PrismaClient,
  RoleInferenceState,
  RoleSource,
  SimilarityAnalysisStatus,
};
export type {
  Collection,
  CollectionDna,
  DesignAsset,
  ExportJob,
  FileAsset,
  GenerationTask,
  Project,
  User,
  Workspace,
};
