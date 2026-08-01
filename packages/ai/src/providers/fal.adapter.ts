import {
  ApiError,
  createFalClient,
  type FalClient,
  type QueueStatus,
} from "@fal-ai/client";
import { z } from "zod";

import { AiProviderError } from "../ai.errors";
import type {
  AiGenerationCost,
  AiGenerationRequest,
  AiProvider,
  AiProviderJob,
  AiProviderJobStatus,
  AiProviderResult,
} from "../provider.interface";

const falResultSchema = z
  .object({
    images: z
      .array(
        z.object({
          url: z.url(),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          content_type: z.string().optional(),
        }),
      )
      .min(1),
    seed: z.number().int().optional(),
    has_nsfw_concepts: z.array(z.boolean()).optional(),
  })
  .loose();

export interface FalAdapterConfig {
  credentials: () => string | undefined;
  t2iModel: string;
  i2iModel: string;
  inpaintModel: string;
  t2iCostPerMegapixel: number;
  i2iCostPerMegapixel: number;
  inpaintCostPerMegapixel: number;
  creditsPerUsd: number;
}

export interface FalQueueTransport {
  cancel?(
    endpoint: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<void>;
  submit(
    endpoint: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ requestId: string }>;
  status(
    endpoint: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<{ status: QueueStatus["status"]; queuePosition?: number }>;
  result(
    endpoint: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export class FalSdkQueueTransport implements FalQueueTransport {
  private readonly client: FalClient;

  constructor(credentials: () => string | undefined) {
    this.client = createFalClient({
      credentials,
      // 重试策略由 AiService 统一管理，避免 SDK 与业务层叠加重试。
      retry: { maxRetries: 0 },
    });
  }

  async submit(
    endpoint: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ requestId: string }> {
    const response = await this.client.queue.submit(endpoint, {
      input,
      abortSignal: signal,
    });
    return { requestId: response.request_id };
  }

  async cancel(
    endpoint: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.client.queue.cancel(endpoint, {
      requestId,
      abortSignal: signal,
    });
  }

  async status(
    endpoint: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<{ status: QueueStatus["status"]; queuePosition?: number }> {
    const response = await this.client.queue.status(endpoint, {
      requestId,
      abortSignal: signal,
      logs: false,
    });
    return response.status === "IN_QUEUE"
      ? {
          status: response.status,
          queuePosition: response.queue_position,
        }
      : { status: response.status };
  }

  async result(
    endpoint: string,
    requestId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await this.client.queue.result(endpoint, {
      requestId,
      abortSignal: signal,
    });
    return response.data;
  }
}

export class FalAdapter implements AiProvider {
  readonly name = "fal";

  constructor(
    private readonly config: FalAdapterConfig,
    private readonly transport: FalQueueTransport = new FalSdkQueueTransport(
      config.credentials,
    ),
  ) {}

  supports(taskType: AiGenerationRequest["taskType"]): boolean {
    return taskType === "t2i" || taskType === "i2i" || taskType === "inpaint";
  }

  async cancel(job: AiProviderJob, signal: AbortSignal): Promise<void> {
    this.assertCredentials();
    if (!this.transport.cancel) {
      return;
    }
    try {
      await this.transport.cancel(job.model, job.providerJobId, signal);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async submit(
    request: AiGenerationRequest,
    signal: AbortSignal,
  ): Promise<AiProviderJob> {
    this.assertCredentials();
    const guidedTextToImage =
      request.taskType === "t2i" && Boolean(request.referenceImageUrl);
    const model =
      request.taskType === "t2i"
        ? guidedTextToImage
          ? this.config.i2iModel
          : this.config.t2iModel
        : request.taskType === "i2i"
          ? this.config.i2iModel
          : this.config.inpaintModel;

    try {
      const response = await this.transport.submit(
        model,
        this.mapInput(request),
        signal,
      );
      return {
        provider: this.name,
        providerJobId: response.requestId,
        model,
        taskType: request.taskType,
        submittedAt: new Date().toISOString(),
        cost: this.calculateCost(request, guidedTextToImage),
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getStatus(
    job: AiProviderJob,
    signal: AbortSignal,
  ): Promise<AiProviderJobStatus> {
    this.assertCredentials();
    try {
      const response = await this.transport.status(
        job.model,
        job.providerJobId,
        signal,
      );
      const statusMap = {
        IN_QUEUE: "queued",
        IN_PROGRESS: "running",
        COMPLETED: "completed",
      } as const;
      const status: AiProviderJobStatus = {
        status: statusMap[response.status],
      };
      if (response.queuePosition !== undefined) {
        status.queuePosition = response.queuePosition;
      }
      return status;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getResult(
    job: AiProviderJob,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    this.assertCredentials();
    try {
      const data = falResultSchema.parse(
        await this.transport.result(job.model, job.providerJobId, signal),
      );
      if (data.has_nsfw_concepts?.some(Boolean)) {
        throw new AiProviderError({
          code: "CONTENT_FLAGGED",
          provider: this.name,
          message: "生成内容未通过安全检查",
        });
      }

      const result: AiProviderResult = {
        job,
        images: data.images.map((image) => {
          const mapped = {
            url: image.url,
            ...(image.width !== undefined ? { width: image.width } : {}),
            ...(image.height !== undefined ? { height: image.height } : {}),
            ...(image.content_type !== undefined
              ? { contentType: image.content_type }
              : {}),
          };
          return mapped;
        }),
        cost: job.cost,
      };
      if (data.seed !== undefined) {
        result.seed = data.seed;
      }
      return result;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new AiProviderError({
          code: "INVALID_RESPONSE",
          provider: this.name,
          message: "fal.ai 返回了无法解析的结果",
          retryable: true,
          cause: error,
        });
      }
      throw this.mapError(error);
    }
  }

  private assertCredentials(): void {
    if (!this.config.credentials()?.trim()) {
      throw new AiProviderError({
        code: "AUTH_FAILED",
        provider: this.name,
        message: "fal.ai 凭据未配置",
      });
    }
  }

  private mapInput(request: AiGenerationRequest): Record<string, unknown> {
    const input: Record<string, unknown> = {
      prompt: request.prompt,
      image_size: {
        width: request.width,
        height: request.height,
      },
      num_inference_steps: request.steps,
      guidance_scale: request.cfg,
      num_images: 1,
      enable_safety_checker: true,
      output_format: "png",
      sync_mode: false,
    };

    if (request.seed !== undefined) {
      input.seed = request.seed;
    }
    if (request.negativePrompt) {
      input.negative_prompt = request.negativePrompt;
    }
    if (
      (request.taskType === "t2i" && request.referenceImageUrl) ||
      request.taskType === "i2i" ||
      request.taskType === "inpaint"
    ) {
      input.image_url = request.referenceImageUrl;
      input.strength = request.strength ?? 0.72;
    }
    if (request.taskType === "inpaint") {
      input.mask_url = request.maskImageUrl;
    }
    return input;
  }

  private calculateCost(
    request: AiGenerationRequest,
    guidedTextToImage = false,
  ): AiGenerationCost {
    const billableMegapixels = Math.max(
      1,
      Math.ceil((request.width * request.height) / 1_000_000),
    );
    const rate =
      request.taskType === "t2i"
        ? guidedTextToImage
          ? this.config.i2iCostPerMegapixel
          : this.config.t2iCostPerMegapixel
        : request.taskType === "i2i"
          ? this.config.i2iCostPerMegapixel
          : this.config.inpaintCostPerMegapixel;
    const rawCost = Number((billableMegapixels * rate).toFixed(6));

    return {
      rawCost,
      credits: Math.ceil(rawCost * this.config.creditsPerUsd),
      currency: "USD",
      billableMegapixels,
      estimated: true,
    };
  }

  private mapError(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) {
      return error;
    }
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      return new AiProviderError({
        code: "TIMEOUT",
        provider: this.name,
        message: "fal.ai 请求超时",
        cause: error,
      });
    }
    if (error instanceof ApiError) {
      return this.mapApiError(error);
    }
    return new AiProviderError({
      code: "PROVIDER_UNAVAILABLE",
      provider: this.name,
      message: "fal.ai 暂时不可用",
      retryable: true,
      cause: error,
    });
  }

  private mapApiError(error: ApiError<unknown>): AiProviderError {
    const status = error.status;
    const bodyText = this.safeBodyText(error.body);
    const isFlagged =
      bodyText.includes("content") &&
      (bodyText.includes("flag") ||
        bodyText.includes("safety") ||
        bodyText.includes("nsfw"));

    if (isFlagged) {
      return new AiProviderError({
        code: "CONTENT_FLAGGED",
        provider: this.name,
        message: "生成内容未通过安全检查",
        status,
        cause: error,
      });
    }
    if (status === 429) {
      return new AiProviderError({
        code: "RATE_LIMITED",
        provider: this.name,
        message: "fal.ai 请求频率受限",
        status,
        cause: error,
      });
    }
    if (status === 401 || status === 403) {
      return new AiProviderError({
        code: "AUTH_FAILED",
        provider: this.name,
        message: "fal.ai 鉴权失败",
        status,
        cause: error,
      });
    }
    if (status === 404) {
      return new AiProviderError({
        code: "NOT_FOUND",
        provider: this.name,
        message: "fal.ai 任务不存在",
        status,
        cause: error,
      });
    }
    if (status >= 500) {
      return new AiProviderError({
        code: "PROVIDER_UNAVAILABLE",
        provider: this.name,
        message: "fal.ai 暂时不可用",
        retryable: true,
        status,
        cause: error,
      });
    }
    if (status === 400 || status === 422) {
      return new AiProviderError({
        code: "INVALID_REQUEST",
        provider: this.name,
        message: "fal.ai 拒绝了请求参数",
        status,
        cause: error,
      });
    }
    return new AiProviderError({
      code: "UNKNOWN",
      provider: this.name,
      message: "fal.ai 请求失败",
      status,
      cause: error,
    });
  }

  private safeBodyText(body: unknown): string {
    if (typeof body === "string") {
      return body.toLowerCase();
    }
    try {
      return JSON.stringify(body).toLowerCase();
    } catch {
      return "";
    }
  }
}
