import {
  GenerationTaskStatus,
  Prisma,
  type PrismaClient,
} from "@fashion/db";
import type { AiGenerationRequest } from "@fashion/ai";
import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { GenerationLimitExceededException } from "../billing/billing.errors";
import { BillingService } from "../billing/billing.service";

export const GENERATION_DB = Symbol("GENERATION_DB");
export const GENERATION_JOBS = Symbol("GENERATION_JOBS");

type GenerationDatabase = Pick<PrismaClient, "generationTask">;

export interface GenerationJobs {
  enqueue(taskId: string, userId: string): Promise<void>;
  cancel(taskId: string): Promise<void>;
}

export interface GenerationTaskView {
  readonly id: string;
  readonly status: Lowercase<keyof typeof GenerationTaskStatus>;
  readonly taskType: string;
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
  ) {}

  async create(
    userId: string,
    request: AiGenerationRequest,
  ): Promise<{ taskId: string }> {
    const quota = await this.billingService.canGenerate(userId);
    if (!quota.allowed) {
      throw new GenerationLimitExceededException();
    }

    const task = await this.database.generationTask.create({
      data: {
        input: request as Prisma.InputJsonValue,
        status: GenerationTaskStatus.QUEUED,
        taskType: request.taskType,
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
