import { z } from "zod";

/** Internal admission-verified identities; never accepted from a generation request. */
export const generationImageSourcesSchema = z
  .object({
    version: z.literal(1),
    entries: z
      .array(
        z
          .object({
            url: z.url(),
            objectKey: z.string().min(1).max(2048),
          })
          .strict(),
      )
      .min(1)
      .max(16),
  })
  .strict();

export type GenerationImageSources = z.infer<
  typeof generationImageSourcesSchema
>;
