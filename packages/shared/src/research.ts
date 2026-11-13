import { z } from "zod";

const id = z.string().trim().min(1).max(128);
export const researchFreshnessSchema = z.enum(["RECENT", "DATED", "UNKNOWN"]);

export const researchSourceSchema = z
  .object({
    id,
    title: z.string().trim().min(1).max(300),
    url: z.string().url().max(2_000),
    domain: z.string().trim().min(1).max(160),
    snippet: z.string().trim().max(2_000),
    publishedAt: z.string().datetime().nullable(),
    imageUrl: z.string().url().max(2_000).nullable(),
    kind: z.enum(["EXTERNAL", "CURATED"]),
    freshness: researchFreshnessSchema,
  })
  .strict();

export const researchSearchResponseSchema = z
  .object({
    query: z.string().trim().min(1).max(240),
    items: z.array(researchSourceSchema).max(20),
  })
  .strict();

export type ResearchSource = z.infer<typeof researchSourceSchema>;
export type ResearchSearchResponse = z.infer<
  typeof researchSearchResponseSchema
>;
