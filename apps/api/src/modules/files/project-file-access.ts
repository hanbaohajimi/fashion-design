import type { Prisma, PrismaClient } from "@fashion/db";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { ProjectAccessPolicy } from "../studio/project-access.policy";

type FileAccessDatabase =
  Pick<PrismaClient, "fileAsset" | "project"> | Prisma.TransactionClient;

/** Sharing requires a persisted reference in this project, never merely the same uploader/workspace. */
export async function requireProjectFile(
  database: FileAccessDatabase,
  access: ProjectAccessPolicy,
  userId: string,
  fileId: string,
  projectId?: string,
  transaction?: Prisma.TransactionClient,
) {
  if (projectId) await access.require(userId, projectId, "read", transaction);
  const file = await database.fileAsset.findUnique({
    where: { id: fileId },
    include: { fabricMainImages: { select: { id: true } } },
  });
  if (!file)
    throw new NotFoundException({
      code: "FILE_NOT_FOUND",
      message: "文件不存在",
    });
  if (file.ownerId === userId) return file;
  const project = await database.project.findFirst({
    where: {
      ...(projectId ? { id: projectId } : {}),
      ...access.readableWhere(userId),
      OR: [
        { designAssets: { some: { sourceFileId: fileId, archivedAt: null } } },
        { boardElements: { some: { fileAssetId: fileId, deletedAt: null } } },
        {
          boardElements: {
            some: {
              deletedAt: null,
              record: { path: ["props", "fileId"], equals: fileId },
            },
          },
        },
        {
          workflowGraph: {
            nodes: {
              some: { payload: { path: ["fileAssetId"], equals: fileId } },
            },
          },
        },
        {
          collections: { some: { dna: { referenceFileIds: { has: fileId } } } },
        },
        ...(file.fabricMainImages ?? []).map((fabric) => ({
          workflowGraph: {
            nodes: {
              some: { payload: { path: ["fabricId"], equals: fabric.id } },
            },
          },
        })),
        ...(file.fabricMainImages ?? []).map((fabric) => ({
          boardElements: {
            some: {
              deletedAt: null,
              record: { path: ["props", "fabricId"], equals: fabric.id },
            },
          },
        })),
      ],
    },
    select: { id: true },
  });
  if (!project)
    throw new ForbiddenException({
      code: "FILE_FORBIDDEN",
      message: "该文件未共享到你可访问的项目",
    });
  await access.require(userId, project.id, "read", transaction);
  return file;
}
