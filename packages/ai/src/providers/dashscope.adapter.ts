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
import {
  ReferenceImageLoadError,
  type ReferenceImageLoader,
} from "../reference-image.loader";

const taskStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELED",
  "UNKNOWN",
]);

const dashScopeResponseSchema = z
  .object({
    request_id: z.string().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
    output: z
      .object({
        task_id: z.string().optional(),
        task_status: taskStatusSchema,
        choices: z
          .array(
            z
              .object({
                message: z
                  .object({
                    content: z.array(
                      z
                        .object({
                          type: z.string().optional(),
                          image: z.url().optional(),
                        })
                        .loose(),
                    ),
                  })
                  .loose(),
              })
              .loose(),
          )
          .optional(),
      })
      .loose(),
  })
  .loose();

export interface DashScopeAdapterConfig {
  readonly apiKey: () => string | undefined;
  readonly baseUrl: string;
  readonly imageModel: string;
  readonly imageSize: string;
  readonly imageCostCny: number;
  readonly creditsPerCny: number;
}

export interface DashScopeTransport {
  submit(body: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
  status(taskId: string, signal: AbortSignal): Promise<unknown>;
}

export class DashScopeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`DashScope HTTP ${status}`);
    this.name = "DashScopeHttpError";
  }
}

export class DashScopeHttpTransport implements DashScopeTransport {
  private readonly baseUrl: string;

  constructor(
    private readonly config: Pick<DashScopeAdapterConfig, "apiKey" | "baseUrl">,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/u, "");
  }

  submit(body: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    return this.request(
      `${this.baseUrl}/api/v1/services/aigc/image-generation/generation`,
      {
        body: JSON.stringify(body),
        headers: { "X-DashScope-Async": "enable" },
        method: "POST",
      },
      signal,
    );
  }

  status(taskId: string, signal: AbortSignal): Promise<unknown> {
    return this.request(
      `${this.baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      { method: "GET" },
      signal,
    );
  }

  private async request(
    url: string,
    init: Pick<RequestInit, "body" | "method"> & {
      headers?: Record<string, string>;
    },
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.apiKey() ?? ""}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal,
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new DashScopeHttpError(response.status, data);
    }
    return data;
  }
}

export class DashScopeAdapter implements AiProvider {
  readonly name = "dashscope";

  constructor(
    private readonly config: DashScopeAdapterConfig,
    private readonly transport: DashScopeTransport = new DashScopeHttpTransport(
      config,
    ),
    private readonly loadReferenceImage?: ReferenceImageLoader,
  ) {}

  supports(taskType: AiGenerationRequest["taskType"]): boolean {
    return taskType === "t2i" || taskType === "i2i";
  }

  async submit(
    request: AiGenerationRequest,
    signal: AbortSignal,
  ): Promise<AiProviderJob> {
    this.assertCredentials();
    if (!this.supports(request.taskType)) {
      throw new AiProviderError({
        code: "INVALID_REQUEST",
        provider: this.name,
        message: "百炼 Wan 2.7 预留渠道暂不承接精确蒙版重绘",
      });
    }
    try {
      const parsed = this.parseResponse(
        await this.transport.submit(
          await this.requestBody(request, signal),
          signal,
        ),
      );
      const taskId = parsed.output.task_id;
      if (!taskId) {
        throw new AiProviderError({
          code: "INVALID_RESPONSE",
          provider: this.name,
          message: "百炼未返回任务 ID",
          retryable: true,
        });
      }
      return {
        provider: this.name,
        providerJobId: taskId,
        model: this.config.imageModel,
        taskType: request.taskType,
        submittedAt: new Date().toISOString(),
        cost: this.calculateCost(request),
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
    this.assertJob(job);
    try {
      const parsed = this.parseResponse(
        await this.transport.status(job.providerJobId, signal),
      );
      return { status: this.mapStatus(parsed) };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getResult(
    job: AiProviderJob,
    signal: AbortSignal,
  ): Promise<AiProviderResult> {
    this.assertCredentials();
    this.assertJob(job);
    try {
      const parsed = this.parseResponse(
        await this.transport.status(job.providerJobId, signal),
      );
      if (this.mapStatus(parsed) !== "completed") {
        throw new AiProviderError({
          code: "INVALID_RESPONSE",
          provider: this.name,
          message: "百炼任务尚未完成，不能读取结果",
          retryable: true,
        });
      }
      const images =
        parsed.output.choices?.flatMap((choice) =>
          choice.message.content.flatMap((item) =>
            item.type === "image" && item.image ? [{ url: item.image }] : [],
          ),
        ) ?? [];
      if (images.length === 0) {
        throw new AiProviderError({
          code: "INVALID_RESPONSE",
          provider: this.name,
          message: "百炼成功任务未返回图片 URL",
          retryable: true,
        });
      }
      return { job, images, cost: job.cost };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private async requestBody(
    request: AiGenerationRequest,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const content: Record<string, string>[] = [];
    if (request.referenceImageUrl) {
      if (!this.loadReferenceImage) {
        throw new AiProviderError({
          code: "INVALID_REQUEST",
          provider: this.name,
          message: "百炼图片编辑缺少参考图加载配置",
        });
      }
      const reference = await this.loadReferenceImage(
        request.referenceImageUrl,
        signal,
      );
      content.push({
        image: `data:${reference.contentType};base64,${Buffer.from(reference.bytes).toString("base64")}`,
      });
    }
    content.push({ text: promptFor(request) });
    return {
      model: this.config.imageModel,
      input: { messages: [{ role: "user", content }] },
      parameters: {
        n: 1,
        size: this.config.imageSize,
        thinking_mode: !request.referenceImageUrl,
        watermark: false,
      },
    };
  }

  private parseResponse(
    response: unknown,
  ): z.infer<typeof dashScopeResponseSchema> {
    try {
      return dashScopeResponseSchema.parse(response);
    } catch (cause) {
      throw new AiProviderError({
        code: "INVALID_RESPONSE",
        provider: this.name,
        message: "百炼返回了无法解析的任务结果",
        retryable: true,
        cause,
      });
    }
  }

  private mapStatus(
    response: z.infer<typeof dashScopeResponseSchema>,
  ): AiProviderJobStatus["status"] {
    const status = response.output.task_status;
    if (status === "PENDING") return "queued";
    if (status === "RUNNING") return "running";
    if (status === "SUCCEEDED") return "completed";
    if (status === "FAILED") {
      throw this.mapTaskFailure(response.code, response.message);
    }
    throw new AiProviderError({
      code: "NOT_FOUND",
      provider: this.name,
      message: `百炼任务不可用：${status}`,
    });
  }

  private calculateCost(request: AiGenerationRequest): AiGenerationCost {
    const billableMegapixels = Math.max(
      1,
      Math.ceil((request.width * request.height) / 1_000_000),
    );
    return {
      rawCost: this.config.imageCostCny,
      credits: Math.ceil(this.config.imageCostCny * this.config.creditsPerCny),
      currency: "CNY",
      billableMegapixels,
      estimated: true,
    };
  }

  private assertCredentials(): void {
    if (!this.config.apiKey()?.trim()) {
      throw new AiProviderError({
        code: "AUTH_FAILED",
        provider: this.name,
        message: "百炼 API Key 未配置",
      });
    }
  }

  private assertJob(job: AiProviderJob): void {
    if (job.provider !== this.name) {
      throw new AiProviderError({
        code: "NOT_FOUND",
        provider: this.name,
        message: "百炼任务不存在",
      });
    }
  }

  private mapTaskFailure(code?: string, message?: string): AiProviderError {
    const body = `${code ?? ""} ${message ?? ""}`.toLowerCase();
    if (body.includes("datainspectionfailed") || body.includes("safety")) {
      return new AiProviderError({
        code: "CONTENT_FLAGGED",
        provider: this.name,
        message: "生成内容未通过百炼安全检查",
      });
    }
    return new AiProviderError({
      code: "PROVIDER_UNAVAILABLE",
      provider: this.name,
      message: "百炼图片生成任务失败",
      retryable: true,
    });
  }

  private mapError(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) return error;
    if (error instanceof ReferenceImageLoadError) {
      return new AiProviderError({
        code: error.kind,
        provider: this.name,
        message: error.message,
        cause: error,
      });
    }
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      return new AiProviderError({
        code: "TIMEOUT",
        provider: this.name,
        message: "百炼请求超时",
        cause: error,
      });
    }
    if (error instanceof DashScopeHttpError) {
      return this.mapHttpError(error);
    }
    return new AiProviderError({
      code: "PROVIDER_UNAVAILABLE",
      provider: this.name,
      message: "百炼暂时不可用",
      retryable: true,
      cause: error,
    });
  }

  private mapHttpError(error: DashScopeHttpError): AiProviderError {
    const body = safeBodyText(error.body);
    if (body.includes("datainspectionfailed") || body.includes("safety")) {
      return dashScopeError(
        "CONTENT_FLAGGED",
        "生成内容未通过百炼安全检查",
        error,
      );
    }
    if (error.status === 429 || body.includes("throttling")) {
      return dashScopeError("RATE_LIMITED", "百炼请求频率受限", error);
    }
    if (
      error.status === 401 ||
      error.status === 403 ||
      body.includes("invalidapikey")
    ) {
      return dashScopeError("AUTH_FAILED", "百炼鉴权失败", error);
    }
    if (error.status >= 500) {
      return dashScopeError(
        "PROVIDER_UNAVAILABLE",
        "百炼暂时不可用",
        error,
        true,
      );
    }
    if (error.status === 400 || error.status === 422) {
      return dashScopeError("INVALID_REQUEST", "百炼拒绝了图片生成参数", error);
    }
    return dashScopeError("UNKNOWN", "百炼图片生成请求失败", error);
  }
}

function promptFor(request: AiGenerationRequest): string {
  const sections = [request.prompt];
  if (request.referenceImageUrl) {
    sections.push(referenceGuidance(request.taskType));
  }
  if (request.negativePrompt) {
    sections.push(`请避免出现：${request.negativePrompt}`);
  }
  return sections.join("\n\n");
}

function referenceGuidance(taskType: AiGenerationRequest["taskType"]): string {
  return taskType === "inpaint"
    ? "只修改蒙版区域，并保持蒙版外内容不变。"
    : "将上传图片作为高保真视觉参考。";
}

function safeBodyText(body: unknown): string {
  try {
    return (
      typeof body === "string" ? body : JSON.stringify(body)
    ).toLowerCase();
  } catch {
    return "";
  }
}

function dashScopeError(
  code: ConstructorParameters<typeof AiProviderError>[0]["code"],
  message: string,
  error: DashScopeHttpError,
  retryable = false,
): AiProviderError {
  return new AiProviderError({
    code,
    provider: "dashscope",
    message,
    retryable,
    status: error.status,
    cause: error,
  });
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 2_000) };
  }
}
