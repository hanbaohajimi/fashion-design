import type { Prisma, PrismaClient } from "@fashion/db";
import type { StudioRole } from "@fashion/shared";
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

export const STUDIO_DB = Symbol("STUDIO_DB");
export type StudioDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "project"
  | "workspaceMember"
  | "style"
  | "styleRevision"
  | "studioDocument"
  | "studioMutation"
  | "designAsset"
  | "collection"
  | "user"
>;
export type ProjectAction = "read" | "edit" | "review" | "manage";
export type ProjectAccessDatabase = Pick<PrismaClient, "project" | "workspaceMember">;
export function studioCapabilities(role: StudioRole) {
  return {
    edit: role === "OWNER" || role === "EDITOR",
    review: role === "OWNER" || role === "REVIEWER",
    manageMembers: role === "OWNER",
  };
}
@Injectable()
export class ProjectAccessPolicy {
  constructor(@Inject(STUDIO_DB) private readonly database: ProjectAccessDatabase) {}
  readableWhere(userId: string): Prisma.ProjectWhereInput {
    return {
      deletedAt: null,
      workspace: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
    };
  }
  async require(
    userId: string,
    projectId: string,
    action: ProjectAction = "read",
    transaction?: ProjectAccessDatabase,
  ) {
    const database = transaction ?? this.database;
    const project = await database.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        wsId: true,
        deletedAt: true,
        archived: true,
        workspace: { select: { ownerId: true } },
      },
    });
    if (!project || project.deletedAt)
      throw new NotFoundException({
        code: "PROJECT_NOT_FOUND",
        message: "项目不存在",
      });
    let role: StudioRole = "OWNER";
    if (project.workspace.ownerId !== userId) {
      const member = await database.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: project.wsId, userId } },
      });
      if (!member)
        throw new ForbiddenException({
          code: "PROJECT_FORBIDDEN",
          message: "无权访问该项目",
        });
      role = member.role;
    }
    const capabilities = studioCapabilities(role);
    if (
      (action === "edit" && !capabilities.edit) ||
      (action === "review" && !capabilities.review) ||
      (action === "manage" && !capabilities.manageMembers)
    )
      throw new ForbiddenException({
        code: "ROLE_FORBIDDEN",
        message: "当前角色没有此操作权限",
      });
    return {
      projectId,
      workspaceId: project.wsId,
      ownerId: project.workspace.ownerId,
      role,
      capabilities,
      archived: project.archived,
    };
  }
}
