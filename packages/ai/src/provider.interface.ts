import { z } from "zod";
import { imageOutpaintSchema, imageAnnotationSchema } from "@fashion/shared";

export const AI_TASK_TYPES = ["t2i", "i2i", "inpaint"] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const AI_REFERENCE_IMAGE_ROLES = [
  "style_ref",
  "fabric_texture",
  "palette_ref",
  "silhouette_ref",
  "detail_ref",
] as const;
export type AiReferenceImageRole = (typeof AI_REFERENCE_IMAGE_ROLES)[number];

const referenceImageSchema = z.object({
  order: z.number().int().min(0).max(15),
  role: z.enum(AI_REFERENCE_IMAGE_ROLES),
  url: z.url(),
  weight: z.number().min(0).max(1),
});

const paletteColorSchema = z.object({
  hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/u)
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(48),
});

const commonRequestSchema = z
  .object({
    background: z.enum(["auto", "opaque", "transparent"]).optional(),
    imageEdit: z.object({ intent: z.enum(["edit", "feedback", "erase", "remove_background", "outpaint"]), outpaint: imageOutpaintSchema.optional(), annotations: z.array(imageAnnotationSchema).max(100).optional() }).strict().optional(),
    prompt: z.string().trim().min(1).max(4_000),
    negativePrompt: z.string().trim().max(3_000).optional(),
    width: z.number().int().min(256).max(2_048).multipleOf(8),
    height: z.number().int().min(256).max(2_048).multipleOf(8),
    outputCompression: z.number().int().min(0).max(100).optional(),
    outputFormat: z.enum(["jpeg", "png", "webp"]).optional(),
    quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  })
  .strict();

export const aiGenerationRequestSchema = z.discriminatedUnion("taskType", [
  commonRequestSchema.extend({
    taskType: z.literal("t2i"),
    referenceImageUrl: z.url().optional(),
    referenceImageUrls: z.array(z.url()).max(16).optional(),
    referenceImages: z.array(referenceImageSchema).max(16).optional(),
  }),
  commonRequestSchema.extend({
    taskType: z.literal("i2i"),
    referenceImageUrl: z.url(),
    referenceImageUrls: z.array(z.url()).max(16).optional(),
    referenceImages: z.array(referenceImageSchema).max(16).optional(),
  }),
  commonRequestSchema.extend({
    taskType: z.literal("inpaint"),
    referenceImageUrl: z.url(),
    maskImageUrl: z.url(),
    palette: z.array(paletteColorSchema).min(1).max(12).optional(),
  }),
]);

export type AiGenerationRequest = z.infer<typeof aiGenerationRequestSchema>;

export type AiProviderStatus = "queued" | "running" | "completed";

export interface AiGenerationCost {
  rawCost: number;
  credits: number;
  currency: "CNY" | "USD";
  billableMegapixels: number;
  estimated: true;
}

export interface AiProviderCompletedResult {
  images: AiGeneratedImage[];
}

export interface AiProviderJob {
  provider: string;
  providerJobId: string;
  model: string;
  taskType: AiTaskType;
  submittedAt: string;
  cost: AiGenerationCost;
  /**
   * 同步 Provider 的即时结果。HTTPS URL 可由 Worker 短暂持久化；GPT Image 2 的
   * data:image Base64 只能停留在进程内存，Worker 必须跳过 providerJob 落库并立即
   * 物化到私有对象存储。
   */
  completedResult?: AiProviderCompletedResult | undefined;
}

export interface AiProviderJobStatus {
  status: AiProviderStatus;
  queuePosition?: number;
}

export interface AiGeneratedImage {
  url: string;
  width?: number | undefined;
  height?: number | undefined;
  contentType?: string | undefined;
}

export interface AiProviderResult {
  job: AiProviderJob;
  images: AiGeneratedImage[];
  cost: AiGenerationCost;
}

export interface AiProvider {
  readonly name: string;

  supports(taskType: AiTaskType): boolean;

  cancel?(job: AiProviderJob, signal: AbortSignal): Promise<void>;

  submit(
    request: AiGenerationRequest,
    signal: AbortSignal,
  ): Promise<AiProviderJob>;

  getStatus(
    job: AiProviderJob,
    signal: AbortSignal,
  ): Promise<AiProviderJobStatus>;

  getResult(job: AiProviderJob, signal: AbortSignal): Promise<AiProviderResult>;
}

const aiGenerationCostSchema = z.object({
  rawCost: z.number().nonnegative(),
  credits: z.number().int().nonnegative(),
  currency: z.enum(["CNY", "USD"]),
  billableMegapixels: z.number().int().positive(),
  estimated: z.literal(true),
});

const aiGeneratedImageSchema = z.object({
  url: z.url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  contentType: z.string().min(1).optional(),
});

export const aiProviderJobSchema = z.object({
  provider: z.string().min(1),
  providerJobId: z.string().min(1),
  model: z.string().min(1),
  taskType: z.enum(AI_TASK_TYPES),
  submittedAt: z.iso.datetime(),
  cost: aiGenerationCostSchema,
  completedResult: z
    .object({
      images: z.array(aiGeneratedImageSchema).min(1),
    })
    .optional(),
});
