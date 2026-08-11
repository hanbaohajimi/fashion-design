import { randomUUID } from "node:crypto";
import { z } from "zod";

import { AiProviderError } from "../ai.errors";
import type {
  AiGenerationCost,
  AiGenerationRequest,
  AiGeneratedImage,
  AiProvider,
  AiProviderJob,
  AiProviderJobStatus,
  AiProviderResult,
} from "../provider.interface";
import {
  ReferenceImageLoadError,
  type LoadedReferenceImage,
  type ReferenceImageLoader,
} from "../reference-image.loader";

const amuxResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            url: z.url().optional(),
            b64_json: z.string().min(1).max(35_000_000).optional(),
          })
          .loose(),
      )
      .min(1),
  })
  .loose();

export interface AmuxAdapterConfig {
  readonly apiKey: () => string | undefined;
  readonly baseUrl: string;
  readonly imageModel: string;
  readonly quality: "auto" | "high" | "low" | "medium";
  readonly imageCostUsd: number;
  readonly editCostUsd: number;
  readonly creditsPerUsd: number;
}

export interface AmuxTransport {
  generate(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
  edit(body: FormData, signal: AbortSignal): Promise<unknown>;
}

export class AmuxHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Amux HTTP ${status}`);
    this.name = "AmuxHttpError";
  }
}

export class AmuxHttpTransport implements AmuxTransport {
  private readonly baseUrl: string;

  constructor(
    private readonly config: Pick<AmuxAdapterConfig, "apiKey" | "baseUrl">,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/+$/u, "");
  }

  generate(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.request("/images/generations", body, signal);
  }

  edit(body: FormData, signal: AbortSignal): Promise<unknown> {
    return this.request("/images/edits", body, signal);
  }

  private async request(
    path: string,
    body: FormData | Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const isForm = body instanceof FormData;
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: isForm ? body : JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${this.config.apiKey() ?? ""}`,
        ...(isForm ? {} : { "Content-Type": "application/json" }),
      },
      method: "POST",
      signal,
    });
    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new AmuxHttpError(response.status, data);
    }
    return data;
  }
}

export class AmuxAdapter implements AiProvider {
  readonly name = "amux";

  constructor(
    private readonly config: AmuxAdapterConfig,
    private readonly transport: AmuxTransport = new AmuxHttpTransport(config),
    private readonly loadReferenceImage?: ReferenceImageLoader,
  ) {}

  supports(taskType: AiGenerationRequest["taskType"]): boolean {
    return taskType === "t2i" || taskType === "i2i" || taskType === "inpaint";
  }

  async submit(
    request: AiGenerationRequest,
    signal: AbortSignal,
  ): Promise<AiProviderJob> {
    this.assertCredentials();
    const usesEdit =
      request.taskType !== "t2i" || Boolean(request.referenceImageUrl);
    try {
      let response: unknown;
      if (usesEdit) {
        response = await this.transport.edit(
          await this.editForm(request, signal),
          signal,
        );
      } else {
        response = await this.transport.generate(
          this.generationBody(request),
          signal,
        );
      }
      const images = this.parseImages(response, request.outputFormat ?? "png");
      return {
        provider: this.name,
        providerJobId: randomUUID(),
        model: this.config.imageModel,
        taskType: request.taskType,
        submittedAt: new Date().toISOString(),
        cost: this.calculateCost(request, usesEdit),
        completedResult: {
          images,
          ...(request.seed === undefined ? {} : { seed: request.seed }),
        },
      };
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async getStatus(job: AiProviderJob): Promise<AiProviderJobStatus> {
    this.assertJob(job);
    return { status: "completed" };
  }

  async getResult(job: AiProviderJob): Promise<AiProviderResult> {
    this.assertJob(job);
    return {
      job: jobWithoutCompletedResult(job),
      images: job.completedResult?.images ?? [],
      ...(job.completedResult?.seed !== undefined
        ? { seed: job.completedResult.seed }
        : {}),
      cost: job.cost,
    };
  }

  private generationBody(
    request: AiGenerationRequest,
    includeReferenceGuidance = true,
  ): Record<string, unknown> {
    const outputFormat = request.outputFormat ?? "png";
    return {
      model: this.config.imageModel,
      prompt: promptFor(request, includeReferenceGuidance),
      n: 1,
      size: gptImage2Size(request.width, request.height),
      quality: request.quality ?? this.config.quality,
      ...(request.background ? { background: request.background } : {}),
      output_format: outputFormat,
      ...(outputFormat !== "png" && request.outputCompression !== undefined
        ? { output_compression: request.outputCompression }
        : {}),
    };
  }

  private async editForm(
    request: AiGenerationRequest,
    signal: AbortSignal,
  ): Promise<FormData> {
    if (!this.loadReferenceImage || !request.referenceImageUrl) {
      throw new AiProviderError({
        code: "INVALID_REQUEST",
        provider: this.name,
        message: "Amux 图片编辑缺少参考图加载配置",
      });
    }

    const form = new FormData();
    form.set("model", this.config.imageModel);
    form.set("prompt", promptFor(request));
    form.set("n", "1");
    form.set("size", gptImage2Size(request.width, request.height));
    form.set("quality", request.quality ?? this.config.quality);
    if (request.background) {
      form.set("background", request.background);
    }
    const outputFormat = request.outputFormat ?? "png";
    form.set("output_format", outputFormat);
    if (outputFormat !== "png" && request.outputCompression !== undefined) {
      form.set("output_compression", String(request.outputCompression));
    }

    // 加载并添加所有参考图片
    const referenceUrls = orderedReferenceImages(request).map(
      (reference) => reference.url,
    );

    for (const url of referenceUrls) {
      const source = await this.loadReferenceImage(url, signal);
      form.append("image", blobFrom(source), source.filename);
    }

    if (request.taskType === "inpaint") {
      const mask = await this.loadReferenceImage(request.maskImageUrl, signal);
      form.set("mask", blobFrom(mask), mask.filename);
    }
    return form;
  }

  private parseImages(
    response: unknown,
    outputFormat: "jpeg" | "png" | "webp",
  ): AiGeneratedImage[] {
    let parsed: z.infer<typeof amuxResponseSchema>;
    try {
      parsed = amuxResponseSchema.parse(response);
    } catch (cause) {
      throw new AiProviderError({
        code: "INVALID_RESPONSE",
        provider: this.name,
        message: "Amux 返回了无法解析的图片结果",
        retryable: true,
        cause,
      });
    }
    const images = parsed.data.flatMap((image) => {
      if (image.url) return [{ url: image.url }];
      if (!image.b64_json || !isBase64(image.b64_json)) return [];
      return [
        {
          url: `data:${contentTypeFor(outputFormat)};base64,${image.b64_json}`,
        },
      ];
    });
    if (images.length === 0) {
      throw new AiProviderError({
        code: "INVALID_RESPONSE",
        provider: this.name,
        message: "Amux 未返回可解析的图片数据",
      });
    }
    return images;
  }

  private calculateCost(
    request: AiGenerationRequest,
    usesEdit: boolean,
  ): AiGenerationCost {
    const billableMegapixels = Math.max(
      1,
      Math.ceil((request.width * request.height) / 1_000_000),
    );
    const rawCost = usesEdit
      ? this.config.editCostUsd
      : this.config.imageCostUsd;
    return {
      rawCost,
      credits: Math.ceil(rawCost * this.config.creditsPerUsd),
      currency: "USD",
      billableMegapixels,
      estimated: true,
    };
  }

  private assertCredentials(): void {
    if (!this.config.apiKey()?.trim()) {
      throw new AiProviderError({
        code: "AUTH_FAILED",
        provider: this.name,
        message: "Amux API Key 未配置",
      });
    }
  }

  private assertJob(job: AiProviderJob): void {
    if (job.provider !== this.name || !job.completedResult?.images.length) {
      throw new AiProviderError({
        code: "NOT_FOUND",
        provider: this.name,
        message: "Amux 同步任务结果不存在",
      });
    }
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
        message: "Amux 请求超时",
        cause: error,
      });
    }
    if (error instanceof AmuxHttpError) {
      return this.mapHttpError(error);
    }
    return new AiProviderError({
      code: "PROVIDER_UNAVAILABLE",
      provider: this.name,
      message: "Amux 暂时不可用",
      retryable: true,
      cause: error,
    });
  }

  private mapHttpError(error: AmuxHttpError): AiProviderError {
    const body = safeBodyText(error.body);
    const contentFlagged =
      body.includes("content") &&
      (body.includes("safety") ||
        body.includes("policy") ||
        body.includes("flag"));
    if (contentFlagged) {
      return providerError("CONTENT_FLAGGED", "生成内容未通过安全检查", error);
    }
    if (error.status === 429) {
      return providerError(
        "RATE_LIMITED",
        "Amux 请求频率受限或余额不足",
        error,
      );
    }
    if (error.status === 401 || error.status === 403) {
      return providerError("AUTH_FAILED", "Amux 鉴权或模型授权失败", error);
    }
    if (error.status === 404) {
      return providerError("NOT_FOUND", "Amux 图片模型不存在", error);
    }
    if (error.status >= 500) {
      return providerError(
        "PROVIDER_UNAVAILABLE",
        `Amux 上游暂时不可用（HTTP ${error.status}）`,
        error,
        true,
      );
    }
    if (error.status === 400 || error.status === 422) {
      const detail = safeProviderErrorDetail(error.body);
      return providerError(
        "INVALID_REQUEST",
        detail
          ? `Amux 拒绝了图片生成参数：${detail}`
          : "Amux 拒绝了图片生成参数",
        error,
      );
    }
    return providerError("UNKNOWN", "Amux 图片生成请求失败", error);
  }
}

function jobWithoutCompletedResult(job: AiProviderJob): AiProviderJob {
  return {
    provider: job.provider,
    providerJobId: job.providerJobId,
    model: job.model,
    taskType: job.taskType,
    submittedAt: job.submittedAt,
    cost: job.cost,
  };
}

function blobFrom(image: LoadedReferenceImage): Blob {
  return new Blob([Uint8Array.from(image.bytes).buffer], {
    type: image.contentType,
  });
}

function promptFor(
  request: AiGenerationRequest,
  includeReferenceGuidance = true,
): string {
  const sections = [request.prompt];
  if (
    includeReferenceGuidance &&
    request.referenceImageUrl &&
    request.strength !== undefined
  ) {
    sections.push(referenceGuidance(request.taskType, request.strength));
  }
  const referenceInstructions = (
    "referenceImages" in request ? (request.referenceImages ?? []) : []
  )
    .slice()
    .sort((left, right) => left.order - right.order)
    .map(
      (reference, index) =>
        `Reference ${index + 1}: ${referenceRoleGuidance(reference.role)}; influence ${Math.round(reference.weight * 100)}%`,
    )
    .join("\n");
  if (includeReferenceGuidance && referenceInstructions) {
    sections.push(referenceInstructions);
  }
  if (request.negativePrompt) {
    sections.push(`Avoid the following elements: ${request.negativePrompt}`);
  }
  return sections.join("\n\n");
}

function orderedReferenceImages(request: AiGenerationRequest): Array<{
  readonly order: number;
  readonly role:
    | "detail_ref"
    | "fabric_texture"
    | "palette_ref"
    | "silhouette_ref"
    | "style_ref";
  readonly url: string;
  readonly weight: number;
}> {
  if ("referenceImages" in request && request.referenceImages?.length) {
    return [...request.referenceImages].sort(
      (left, right) => left.order - right.order,
    );
  }
  const urls =
    "referenceImageUrls" in request && request.referenceImageUrls?.length
      ? request.referenceImageUrls
      : "referenceImageUrl" in request && request.referenceImageUrl
        ? [request.referenceImageUrl]
        : [];
  return urls.map((url, order) => ({
    order,
    role: "style_ref" as const,
    url,
    weight:
      "strength" in request && request.strength !== undefined
        ? request.strength
        : 0.5,
  }));
}

function referenceRoleGuidance(
  role:
    | "detail_ref"
    | "fabric_texture"
    | "palette_ref"
    | "silhouette_ref"
    | "style_ref",
): string {
  switch (role) {
    case "fabric_texture":
      return "fabric texture and material behavior";
    case "palette_ref":
      return "color palette only";
    case "silhouette_ref":
      return "garment silhouette and proportion only";
    case "detail_ref":
      return "garment construction detail only";
    case "style_ref":
      return "style and visual language";
  }
}

function referenceGuidance(
  taskType: AiGenerationRequest["taskType"],
  strength: number,
): string {
  const variation =
    strength <= 0.33
      ? "Make only subtle changes and preserve the source composition and identity closely."
      : strength <= 0.66
        ? "Balance source-image fidelity with clearly visible design changes."
        : "Allow substantial visual changes while retaining the source elements required by the prompt.";
  return taskType === "inpaint"
    ? `Modify only the masked area. ${variation}`
    : `Use the uploaded image as a high-fidelity visual reference. ${variation}`;
}

const GPT_IMAGE_2_DIMENSION_MULTIPLE = 16;
const GPT_IMAGE_2_MAX_DIMENSION = 3_840;
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400;
const GPT_IMAGE_2_MIN_PIXELS = 655_360;
const GPT_IMAGE_2_MAX_RATIO = 3;

function gptImage2Size(width: number, height: number): string {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new AiProviderError({
      code: "INVALID_REQUEST",
      provider: "amux",
      message: `GPT Image 2 尺寸无效：${width}x${height}`,
    });
  }

  let normalizedWidth = alignedDimension(width, "nearest");
  let normalizedHeight = alignedDimension(height, "nearest");

  [normalizedWidth, normalizedHeight] = constrainAspectRatio(
    normalizedWidth,
    normalizedHeight,
  );

  let pixels = normalizedWidth * normalizedHeight;
  if (pixels < GPT_IMAGE_2_MIN_PIXELS) {
    const scale = Math.sqrt(GPT_IMAGE_2_MIN_PIXELS / pixels);
    normalizedWidth = alignedDimension(normalizedWidth * scale, "up");
    normalizedHeight = alignedDimension(normalizedHeight * scale, "up");
  }

  pixels = normalizedWidth * normalizedHeight;
  if (pixels > GPT_IMAGE_2_MAX_PIXELS) {
    const scale = Math.sqrt(GPT_IMAGE_2_MAX_PIXELS / pixels);
    normalizedWidth = alignedDimension(normalizedWidth * scale, "down");
    normalizedHeight = alignedDimension(normalizedHeight * scale, "down");
    [normalizedWidth, normalizedHeight] = constrainAspectRatio(
      normalizedWidth,
      normalizedHeight,
    );
  }

  return `${normalizedWidth}x${normalizedHeight}`;
}

function alignedDimension(
  value: number,
  direction: "down" | "nearest" | "up",
): number {
  const align =
    direction === "up"
      ? Math.ceil
      : direction === "down"
        ? Math.floor
        : Math.round;
  const aligned =
    align(value / GPT_IMAGE_2_DIMENSION_MULTIPLE) *
    GPT_IMAGE_2_DIMENSION_MULTIPLE;
  return Math.min(
    GPT_IMAGE_2_MAX_DIMENSION,
    Math.max(GPT_IMAGE_2_DIMENSION_MULTIPLE, aligned),
  );
}

function constrainAspectRatio(width: number, height: number): [number, number] {
  if (width > height * GPT_IMAGE_2_MAX_RATIO) {
    return [width, alignedDimension(width / GPT_IMAGE_2_MAX_RATIO, "up")];
  }
  if (height > width * GPT_IMAGE_2_MAX_RATIO) {
    return [alignedDimension(height / GPT_IMAGE_2_MAX_RATIO, "up"), height];
  }
  return [width, height];
}

function contentTypeFor(outputFormat: string): string {
  return outputFormat === "jpeg" ? "image/jpeg" : `image/${outputFormat}`;
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

function safeProviderErrorDetail(body: unknown): string | undefined {
  let message: string | undefined;
  if (isRecord(body) && isRecord(body.error)) {
    message =
      typeof body.error.message === "string"
        ? body.error.message
        : typeof body.error.code === "string"
          ? body.error.code
          : undefined;
  } else if (isRecord(body) && typeof body.message === "string") {
    message = body.message;
  }
  if (!message) return undefined;
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[已隐藏密钥]")
    .replace(/\bBearer\s+\S+/giu, "Bearer [已隐藏密钥]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function providerError(
  code: ConstructorParameters<typeof AiProviderError>[0]["code"],
  message: string,
  error: AmuxHttpError,
  retryable = false,
): AiProviderError {
  return new AiProviderError({
    code,
    provider: "amux",
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
