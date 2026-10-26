import { z } from "zod";

export const RUNWAY_STAGES = [
  "prepare",
  "pairing",
  "tryon",
  "storyboard",
  "video",
  "compose",
  "music",
  "finished",
] as const;
export const RUNWAY_MEDIA_KINDS = [
  "model",
  "cloth",
  "background",
  "tryon",
  "storyboard",
  "video",
  "silent_video",
  "music",
  "final_video",
  "poster",
] as const;
export const RUNWAY_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_INPUT",
  "SUCCEEDED",
  "FAILED",
  "NEEDS_ATTENTION",
  "CANCELED",
] as const;
export type RunwayStage = (typeof RUNWAY_STAGES)[number];
export type RunwayStatus = (typeof RUNWAY_STATUSES)[number];
export const runwayInputSchema = z
  .object({
    kind: z.enum(["model", "cloth", "background"]),
    sourceType: z.enum(["file", "asset", "style_revision"]),
    sourceId: z.string().min(1).max(100),
  })
  .strict();
export const runwayDraftSchema = z
  .object({
    prompt: z.string().trim().min(1).max(8000),
    modelCount: z.number().int().positive().default(6),
    withMusic: z.boolean().default(true),
    inputs: z.array(runwayInputSchema).max(100).default([]),
  })
  .strict()
  .refine((draft) => draft.inputs.filter((input) => input.kind === "background").length <= 1, {
    message: "一场服装秀使用一张共享秀场背景，请替换已有背景",
    path: ["inputs"],
  });
export type RunwayDraft = z.infer<typeof runwayDraftSchema>;
const requestKey = z.string().min(1).max(120);
export const runwayCreateShowSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    draft: runwayDraftSchema,
    requestKey,
  })
  .strict();
export const runwayUpdateShowSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    draft: runwayDraftSchema.optional(),
    archived: z.boolean().optional(),
    requestKey,
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const runwayStartSchema = z
  .object({ requestKey, expectedVersion: z.number().int().positive() })
  .strict();
export const runwayActionSchema = z
  .object({
    kind: z.enum([
      "confirm",
      "pair",
      "edit",
      "retry",
      "continue",
      "keep_silent",
    ]),
    requestKey,
    expectedVersion: z.number().int().positive(),
    interruptId: z.string().min(1).max(120).optional(),
    pairings: z
      .array(
        z
          .object({
            modelMediaId: z.string().min(1),
            clothMediaId: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .optional(),
    mediaId: z.string().min(1).optional(),
    instruction: z.string().trim().min(1).max(4000).optional(),
    stage: z.enum(RUNWAY_STAGES).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "pair" && !value.pairings)
      ctx.addIssue({
        code: "custom",
        message: "请选择模特与服装配对",
        path: ["pairings"],
      });
    if (value.kind === "edit" && (!value.mediaId || !value.instruction))
      ctx.addIssue({
        code: "custom",
        message: "请选择图片并填写修改要求",
        path: ["instruction"],
      });
  });
export type RunwayAction = z.infer<typeof runwayActionSchema>;
export const runwayForkSchema = z
  .object({
    requestKey,
    expectedVersion: z.number().int().positive(),
    stage: z.enum(RUNWAY_STAGES),
    mediaId: z.string().min(1).max(100).optional(),
  })
  .strict();
export const runwayCancelSchema = z
  .object({ requestKey, expectedVersion: z.number().int().positive() })
  .strict();
export interface RunwayMediaView {
  id: string;
  runId: string;
  kind: (typeof RUNWAY_MEDIA_KINDS)[number];
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  source: Record<string, unknown>;
  createdAt: string;
  contentUrl: string;
}
export interface RunwayPendingInput {
  interruptId: string;
  kind: "confirm" | "pair";
  stage: RunwayStage;
  message: string;
  mediaIds?: string[];
  [key: string]: unknown;
}
export interface RunwayRunView {
  id: string;
  showId: string;
  projectId: string;
  status: RunwayStatus;
  stage: RunwayStage;
  version: number;
  inputSnapshot: RunwayDraft;
  modelSnapshot: Record<string, unknown>;
  state: Record<string, unknown>;
  pendingInput: RunwayPendingInput | null;
  parentRunId: string | null;
  parentStage: string | null;
  cancelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  media: RunwayMediaView[];
  errorCode?: string | null;
}
export interface RunwayShowView {
  id: string;
  projectId: string;
  title: string;
  draft: RunwayDraft;
  version: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  runs: RunwayRunView[];
}
export interface RunwayCapabilities {
  enabled: boolean;
  workerOnline: boolean;
  mode: "mock" | "live";
  capabilities: Record<string, boolean>;
  canEdit: boolean;
}
export interface RunwayEventView {
  id: string;
  runId: string;
  sequence: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}
