import { z } from "zod";

export const loginRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) }).strict(),
  z.object({ action: z.literal("verify"), tokenHash: z.string().min(32).max(2048) }).strict(),
  z.object({ action: z.literal("refresh") }).strict(),
]);
