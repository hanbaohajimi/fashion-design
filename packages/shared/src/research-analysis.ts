import { z } from "zod";

import { researchSourceSchema } from "./research";

const text = z.string().trim().max(2_000);
const token = z.string().trim().min(1).max(80);
const evidence = z.object({
  sourceId: z.string().trim().min(1).max(128),
  claims: z.array(text).min(1).max(6),
}).strict();

export const researchAnalysisInputSchema = z
  .object({
    goal: z.string().trim().min(1).max(240),
    directions: z.string().trim().max(2_000).default(""),
    sources: z.array(researchSourceSchema).min(1).max(6),
  })
  .strict();

export const researchAnalysisSchema = z
  .object({
    mode: z.enum(["AI", "EXTRACTED"]),
    summary: text,
    keywords: z.array(token).max(20),
    silhouettes: z.array(token).max(16),
    fabrics: z.array(token).max(16),
    colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/u)).max(16),
    hypotheses: z.array(text).max(8),
    unknowns: z.array(text).max(12),
    evidence: z.array(evidence).max(6),
  })
  .strict();

export type ResearchAnalysisInput = z.infer<typeof researchAnalysisInputSchema>;
export type ResearchAnalysis = z.infer<typeof researchAnalysisSchema>;
