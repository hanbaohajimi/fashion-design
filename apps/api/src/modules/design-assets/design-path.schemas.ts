import { DESIGN_DECISION_KINDS } from "@fashion/shared";
import { z } from "zod";

export const designDecisionSchema = z.object({
  kind: z.enum(DESIGN_DECISION_KINDS),
  reason: z.string().trim().max(1_000).default(""),
  clientRequestId: z.string().trim().min(1).max(128),
});

export const designStepSnapshotSchema = z.object({
  version: z.literal(1),
  sources: z.array(
    z.object({
      elementId: z.string(),
      shapeId: z.string().optional(),
      role: z.string(),
      title: z.string(),
      assetId: z.string().optional(),
      fileAssetId: z.string().optional(),
      fabricId: z.string().optional(),
      trendItemId: z.string().optional(),
      text: z.string().optional(),
      colors: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    }),
  ),
  constraints: z.object({
    palette: z.array(z.string()),
    notes: z.array(z.string()),
    avoidLabels: z.array(z.string()),
    fabricTerms: z.array(z.string()),
  }),
  parameters: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()]),
  ),
});

export type DesignDecisionInput = z.infer<typeof designDecisionSchema>;
