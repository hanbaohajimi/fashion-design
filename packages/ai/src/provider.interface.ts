import { z } from "zod";

export const AI_TASK_TYPES = ["t2i", "i2i", "inpaint"] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];

const commonRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  negativePrompt: z.string().trim().max(3_000).optional(),
  width: z.number().int().min(256).max(2_048).multipleOf(8),
  height: z.number().int().min(256).max(2_048).multipleOf(8),
  steps: z.number().int().min(1).max(100),
  cfg: z.number().min(0).max(30),
  seed: z.number().int().min(0).max(4_294_967_295).optional(),
});

export const aiGenerationRequestSchema = z.discriminatedUnion("taskType", [
  commonRequestSchema.extend({
    taskType: z.literal("t2i"),
  }),
  commonRequestSchema.extend({
    taskType: z.literal("i2i"),
    referenceImageUrl: z.url(),
    strength: z.number().min(0).max(1),
  }),
  commonRequestSchema.extend({
    taskType: z.literal("inpaint"),
    referenceImageUrl: z.url(),
    maskImageUrl: z.url(),
    strength: z.number().min(0).max(1),
  }),
]);

export type AiGenerationRequest = z.infer<typeof aiGenerationRequestSchema>;

export type AiProviderStatus = "queued" | "running" | "completed";

export interface AiGenerationCost {
  rawCost: number;
  credits: number;
  currency: "USD";
  billableMegapixels: number;
  estimated: true;
}

export interface AiProviderJob {
  provider: string;
  providerJobId: string;
  model: string;
  taskType: AiTaskType;
  submittedAt: string;
  cost: AiGenerationCost;
}

export interface AiProviderJobStatus {
  status: AiProviderStatus;
  queuePosition?: number;
}

export interface AiGeneratedImage {
  url: string;
  width?: number;
  height?: number;
  contentType?: string;
}

export interface AiProviderResult {
  job: AiProviderJob;
  images: AiGeneratedImage[];
  seed?: number;
  cost: AiGenerationCost;
}

export interface AiProvider {
  readonly name: string;

  supports(taskType: AiTaskType): boolean;

  submit(
    request: AiGenerationRequest,
    signal: AbortSignal,
  ): Promise<AiProviderJob>;

  getStatus(
    job: AiProviderJob,
    signal: AbortSignal,
  ): Promise<AiProviderJobStatus>;

  getResult(
    job: AiProviderJob,
    signal: AbortSignal,
  ): Promise<AiProviderResult>;
}
