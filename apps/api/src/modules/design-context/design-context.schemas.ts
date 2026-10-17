import { z } from "zod";

const id = z.string().trim().min(1).max(128);
const origin = z.enum(["explicit", "inferred"]);

export const contextItemSchema = z.object({
  id,
  kind: z.enum(["requirement", "preference"]),
  text: z.string().trim().min(1).max(2_000),
  origin: origin.default("explicit"),
  priority: z.enum(["must", "prefer"]).default("prefer"),
  status: z.enum(["active", "inactive"]).default("active"),
  scope: z.enum(["project", "branch"]).default("project"),
  branchNodeIds: z.array(id).max(16).default([]),
  sourceMessageId: id.nullable().default(null),
  sourceNodeIds: z.array(id).max(16).default([]),
  sourceVersionIds: z.array(id).max(16).optional(),
  sourceQuote: z.string().trim().min(1).max(2_000).nullable().default(null),
}).strict().superRefine((value, ctx) => {
  if (value.scope === "branch" && !value.branchNodeIds.length)
    ctx.addIssue({ code: "custom", message: "分支上下文必须指定来源节点", path: ["branchNodeIds"] });
  if (value.scope === "project" && value.branchNodeIds.length)
    ctx.addIssue({ code: "custom", message: "项目上下文不能绑定分支节点", path: ["branchNodeIds"] });
});

export const projectDesignContextStateSchema = z.object({
  version: z.literal("project-design-context/1"),
  initialObjective: z.string().max(4_000).nullable(),
  currentObjective: z.string().max(4_000).nullable(),
  objectiveOrigin: origin.nullable(),
  objectiveSourceMessageId: id.nullable().default(null),
  objectiveSourceNodeIds: z.array(id).max(16).default([]),
  objectiveSourceQuote: z.string().max(2_000).nullable().default(null),
  requirements: z.array(contextItemSchema).max(100),
  preferences: z.array(contextItemSchema).max(100),
}).strict();

export const patchProjectDesignContextSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  mutationId: z.string().trim().min(8).max(200).optional(),
  sourceMessageId: id.optional(),
  operations: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("set_objective"), text: z.string().trim().min(1).max(4_000), origin: origin.default("explicit"), sourceQuote: z.string().trim().min(1).max(2_000).optional() }).strict(),
    z.object({ type: z.literal("upsert_item"), item: contextItemSchema }).strict(),
    z.object({ type: z.literal("deactivate_item"), id }).strict(),
  ])).min(1).max(50),
}).strict();

export const updateContextSummarySchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  graphRevision: z.number().int().nonnegative(),
  focusNodeIds: z.array(id).max(16).optional(),
  currentTask: z.string().trim().max(4_000).nullable().optional(),
  summary: z.object({
    text: z.string().max(12_000),
    sourceMessageIds: z.array(id).max(200).default([]),
    omittedMessageCount: z.number().int().nonnegative().default(0),
    coveredMessageCount: z.number().int().nonnegative().optional(),
    truncatedMessageCount: z.number().int().nonnegative().optional(),
    pendingMessageCount: z.number().int().nonnegative().optional(),
    entries: z.array(z.object({ messageId: id, role: z.string().max(20), text: z.string().max(600), contentTruncated: z.boolean() }).strict()).max(200).optional(),
    legacyText: z.string().max(12_000).optional(),
    legacySourceMessageIds: z.array(id).max(200).optional(),
    semanticMemory: z.object({
      version: z.literal("dialog-semantic-memory/1"),
      goalEvolution: z.array(z.object({ id, text: z.string().max(1_000), evidenceRefIds: z.array(id).max(16) }).strict()).max(32),
      rejectedUnderstandings: z.array(z.object({ id, text: z.string().max(1_000), evidenceRefIds: z.array(id).max(16) }).strict()).max(32),
      decisions: z.array(z.object({ id, text: z.string().max(1_000), evidenceRefIds: z.array(id).max(16) }).strict()).max(32),
      openQuestions: z.array(z.object({ id, text: z.string().max(1_000), evidenceRefIds: z.array(id).max(16) }).strict()).max(32),
      evidenceRefs: z.array(z.object({ id, messageId: id, quote: z.string().max(1_000), role: z.string().max(20) }).strict()).max(128),
      omittedEntryCount: z.number().int().nonnegative(),
      method: z.literal("source_labeled_sentences"),
    }).strict().optional(),
  }).strict().optional(),
  throughMessageId: id.nullable().optional(),
}).strict();

export type ContextItem = z.infer<typeof contextItemSchema>;
export type ProjectDesignContextState = z.infer<typeof projectDesignContextStateSchema>;
export type PatchProjectDesignContextInput = z.input<typeof patchProjectDesignContextSchema>;
export type UpdateContextSummaryInput = z.input<typeof updateContextSummarySchema>;

export function emptyProjectDesignContext(): ProjectDesignContextState {
  return { version: "project-design-context/1", initialObjective: null, currentObjective: null, objectiveOrigin: null, objectiveSourceMessageId: null, objectiveSourceNodeIds: [], objectiveSourceQuote: null, requirements: [], preferences: [] };
}
