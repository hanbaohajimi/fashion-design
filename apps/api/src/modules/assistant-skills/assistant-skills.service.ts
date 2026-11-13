import { createHash } from "node:crypto";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AssistantSkillScope, type PrismaClient } from "@fashion/db";
import {
  assistantSkillViewSchema,
  type AssistantSkillInput,
  type AssistantSkillView,
} from "@fashion/shared";

import { ProjectAccessPolicy } from "../studio/project-access.policy";

export const ASSISTANT_SKILLS_DB = Symbol("ASSISTANT_SKILLS_DB");
type Database = Pick<PrismaClient, "assistantSkill">;
type SkillRecord = Awaited<ReturnType<Database["assistantSkill"]["findUnique"]>>;

const PERSONAL_LIMIT = 24;
const WORKSPACE_LIMIT = 48;

function fingerprint(input: AssistantSkillInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function view(record: NonNullable<SkillRecord>): AssistantSkillView {
  return assistantSkillViewSchema.parse({
    createdAt: record.createdAt.toISOString(),
    description: record.description,
    id: record.id,
    name: record.name,
    ownerId: record.ownerId,
    prompt: record.prompt,
    scope: record.scope,
    updatedAt: record.updatedAt.toISOString(),
    workspaceId: record.workspaceId,
  });
}

@Injectable()
export class AssistantSkillsService {
  constructor(
    @Inject(ASSISTANT_SKILLS_DB) private readonly database: Database,
    @Inject(ProjectAccessPolicy)
    private readonly access: ProjectAccessPolicy,
  ) {}

  async list(userId: string, projectId: string): Promise<AssistantSkillView[]> {
    const permission = await this.access.require(userId, projectId, "read");
    const records = await this.database.assistantSkill.findMany({
      where: {
        OR: [
          { ownerId: userId, scope: AssistantSkillScope.PERSONAL },
          {
            scope: AssistantSkillScope.WORKSPACE,
            workspaceId: permission.workspaceId,
          },
        ],
      },
      orderBy: [{ scope: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
    });
    return records.map(view);
  }

  async create(
    userId: string,
    projectId: string,
    input: AssistantSkillInput,
    requestKey: string,
  ): Promise<AssistantSkillView> {
    const scope =
      input.scope === "WORKSPACE"
        ? AssistantSkillScope.WORKSPACE
        : AssistantSkillScope.PERSONAL;
    const permission = await this.access.require(
      userId,
      projectId,
      scope === AssistantSkillScope.WORKSPACE ? "edit" : "read",
    );
    const requestFingerprint = fingerprint(input);
    const existing = await this.database.assistantSkill.findUnique({
      where: { ownerId_requestKey: { ownerId: userId, requestKey } },
    });
    if (existing) {
      if (existing.fingerprint !== requestFingerprint)
        throw new ConflictException({
          code: "IDEMPOTENCY_KEY_REUSED",
          message: "该请求编号已用于其他技能",
        });
      return view(existing);
    }

    const count = await this.database.assistantSkill.count({
      where:
        scope === AssistantSkillScope.WORKSPACE
          ? { scope, workspaceId: permission.workspaceId }
          : { scope, ownerId: userId },
    });
    const limit =
      scope === AssistantSkillScope.WORKSPACE
        ? WORKSPACE_LIMIT
        : PERSONAL_LIMIT;
    if (count >= limit)
      throw new ConflictException({
        code: "ASSISTANT_SKILL_LIMIT_REACHED",
        message: `技能数量已达到上限 ${limit}`,
      });

    const record = await this.database.assistantSkill.create({
      data: {
        description: input.description,
        fingerprint: requestFingerprint,
        name: input.name,
        ownerId: userId,
        prompt: input.prompt,
        requestKey,
        scope,
        ...(scope === AssistantSkillScope.WORKSPACE
          ? { workspaceId: permission.workspaceId }
          : {}),
      },
    });
    return view(record);
  }

  async remove(userId: string, projectId: string, skillId: string) {
    const skill = await this.database.assistantSkill.findUnique({
      where: { id: skillId },
    });
    if (!skill) throw new NotFoundException("技能不存在");
    const permission = await this.access.require(userId, projectId, "read");
    if (skill.scope === AssistantSkillScope.PERSONAL) {
      if (skill.ownerId !== userId)
        throw new ForbiddenException("不能删除其他账号的个人技能");
    } else {
      if (skill.workspaceId !== permission.workspaceId)
        throw new ForbiddenException("不能删除其他工作区的技能");
      await this.access.require(userId, projectId, "edit");
    }
    await this.database.assistantSkill.delete({ where: { id: skillId } });
    return { ok: true };
  }
}

