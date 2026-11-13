import { z } from "zod";

const id = z.string().trim().min(1).max(128);

function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const assistantDelegationCadenceSchema = z.enum([
  "ONCE",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
]);

export const assistantDelegationStatusSchema = z.enum([
  "ACTIVE",
  "PAUSED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

export const assistantDelegationInputSchema = z
  .object({
    conversationId: id,
    name: z.string().trim().min(1).max(80),
    prompt: z.string().trim().min(1).max(4_000),
    cadence: assistantDelegationCadenceSchema,
    nextRunAt: z.iso.datetime(),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .default("Asia/Shanghai")
      .refine(isSupportedTimeZone, "请选择有效的时区"),
  })
  .strict();

export const assistantDelegationViewSchema = z
  .object({
    id,
    projectId: id,
    conversationId: id,
    ownerId: id,
    name: z.string(),
    prompt: z.string(),
    cadence: assistantDelegationCadenceSchema,
    status: assistantDelegationStatusSchema,
    nextRunAt: z.string(),
    lastRunAt: z.string().nullable(),
    lastError: z.string().nullable(),
    runCount: z.number().int().nonnegative(),
    timeZone: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const assistantDelegationStateSchema = z
  .object({
    status: z.enum(["ACTIVE", "PAUSED"]),
  })
  .strict();

export type AssistantDelegationCadence = z.infer<
  typeof assistantDelegationCadenceSchema
>;
export type AssistantDelegationInput = z.infer<
  typeof assistantDelegationInputSchema
>;
export type AssistantDelegationStateInput = z.infer<
  typeof assistantDelegationStateSchema
>;
export type AssistantDelegationStatus = z.infer<
  typeof assistantDelegationStatusSchema
>;
export type AssistantDelegationView = z.infer<
  typeof assistantDelegationViewSchema
>;
