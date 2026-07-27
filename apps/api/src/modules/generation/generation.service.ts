import {
  GenerationTaskStatus,
  Prisma,
  type PrismaClient,
} from "@fashion/db";
import type { AiGenerationRequest } from "@fashion/ai";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { GenerationLimitExceededException } from "../billing/billing.errors";
import { BillingService } from "../billing/billing.service";
import { ContextCompilerService } from "./compiler/context-compiler.service";
import type { GenerationCreateRequest } from "./generation.schemas";

export const GENERATION_DB = Symbol("GENERATION_DB");
export const GENERATION_JOBS = Symbol("GENERATION_JOBS");

type GenerationDatabase = Pick<
  PrismaClient,
  "designAsset" | "generationTask"
>;

export interface GenerationJobs {
  enqueue(taskId: string, userId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
}

export interface GenerationTaskView {
  readonly id: string;
  readonly status: Lowercase<keyof typeof GenerationTaskStatus>;
  readonly taskType: string;
  readonly compiledPrompt: unknown;
  readonly output: unknown;
  readonly error:
    | {
        readonly code: string;
        readonly message: string;
      }
    | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

@Injectable()
export class GenerationService {
  constructor(
    @Inject(GENERATION_DB) private readonly database: GenerationDatabase,
    @Inject(GENERATION_JOBS) private readonly jobs: GenerationJobs,
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(ContextCompilerService)
    private readonly compiler: ContextCompilerService,
  ) {}

  async create(
    userId: string,
    request: GenerationCreateRequest,
  ): Promise<{ taskId: string }> {
    const quota = await this.billingService.canGenerate(userId);
    if (!quota.allowed) {
      throw new GenerationLimitExceededException();
    }
    await this.assertParentAsset(
      userId,
      request.projectId,
      request.parentAssetId,
    );

    const compiledPrompt = await this.compiler.compile(
      userId,
      request.projectId,
      request.prompt,
      request.shapeIds,
    );
    const providerRequest = { ...request };
    delete providerRequest.parentAssetId;
    delete providerRequest.projectId;
    delete providerRequest.shapeIds;
    const input: AiGenerationRequest = {
      ...providerRequest,
      negativePrompt: compiledPrompt.negativePrompt.slice(0, 3_000),
      prompt: compiledPrompt.positivePrompt.slice(0, 4_000),
    };

    const task = await this.database.generationTask.create({
      data: {
        compiledPrompt: compiledPrompt as unknown as Prisma.InputJsonValue,
        input: input as Prisma.InputJsonValue,
        ...(request.parentAssetId
          ? { parentAssetId: request.parentAssetId }
          : {}),
        ...(request.projectId ? { projectId: request.projectId } : {}),
        status: GenerationTaskStatus.QUEUED,
        taskType: input.taskType,
        userId,
      },
      select: { id: true },
    });

    try {
      await this.jobs.enqueue(task.id, userId);
    } catch (error) {
      await this.database.generationTask.update({
        where: { id: task.id },
        data: {
          completedAt: new Date(),
          errorCode: "QUEUE_UNAVAILABLE",
          errorMessage: "生成队列暂时不可用",
          status: GenerationTaskStatus.FAILED,
        },
      });
      throw new ServiceUnavailableException(
        {
          code: "QUEUE_UNAVAILABLE",
          message: "生成队列暂时不可用，请稍后重试",
        },
        { cause: error },
      );
    }

    return { taskId: task.id };
  }

  private async assertParentAsset(
    userId: string,
    projectId: string | undefined,
    parentAssetId: string | undefined,
  ): Promise<void> {
    if (!parentAssetId) return;
    if (!projectId) {
      throw new BadRequestException({
        code: "PARENT_ASSET_REQUIRES_PROJECT",
        message: "血缘资产必须关联项目",
      });
    }
    const parent = await this.database.designAsset.findUnique({
      where: { id: parentAssetId },
      include: {
        project: {
          select: {
            workspace: { select: { ownerId: true } },
          },
        },
      },
    });
    if (!parent) {
      throw new NotFoundException({
        code: "DESIGN_ASSET_NOT_FOUND",
        message: "父资产不存在",
      });
    }
    if (parent.project.workspace.ownerId !== userId) {
      throw new ForbiddenException({
        code: "DESIGN_ASSET_FORBIDDEN",
        message: "无权使用该父资产",
      });
    }
    if (parent.projectId !== projectId) {
      throw new BadRequestException({
        code: "ASSET_PROJECT_MISMATCH",
        message: "父资产不属于当前项目",
      });
    }
  }

  async get(userId: string, taskId: string): Promise<GenerationTaskView> {
    const task = await this.database.generationTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) {
      throw new NotFoundException({
        code: "GENERATION_TASK_NOT_FOUND",
        message: "生成任务不存在",
      });
    }
    return this.toView(task);
  }

  async cancel(
    userId: string,
    taskId: string,
  ): Promise<GenerationTaskView> {
    const task = await this.database.generationTask.findFirst({
      where: { id: taskId, userId },
    });
    if (!task) {
      throw new NotFoundException({
        code: "GENERATION_TASK_NOT_FOUND",
        message: "生成任务不存在",
      });
    }

    if (
      task.status === GenerationTaskStatus.QUEUED ||
      task.status === GenerationTaskStatus.RUNNING
    ) {
      const canceled = await this.database.generationTask.update({
        where: { id: task.id },
        data: {
          canceledAt: new Date(),
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
          status: GenerationTaskStatus.CANCELED,
        },
      });
      await this.jobs.cancel(task.id).catch(() => undefined);
      return this.toView(canceled);
    }

    return this.toView(task);
  }

  private toView(task: {
    id: string;
    status: GenerationTaskStatus;
    taskType: string;
    compiledPrompt: Prisma.JsonValue | null;
    output: Prisma.JsonValue | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): GenerationTaskView {
    return {
      id: task.id,
      status: task.status.toLowerCase() as GenerationTaskView["status"],
      taskType: task.taskType,
      compiledPrompt: task.compiledPrompt,
      output: task.output,
      error:
        task.errorCode && task.errorMessage
          ? { code: task.errorCode, message: task.errorMessage }
          : null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }
}
