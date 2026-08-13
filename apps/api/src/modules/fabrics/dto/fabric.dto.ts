import { z } from "zod";

export const fabricTagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, "标签不能为空")
      .max(30, "单个标签不能超过 30 个字"),
  )
  .min(1, "请至少添加一个标签")
  .max(12, "标签不能超过 12 个")
  .transform((tags) => [...new Set(tags)]);

export const createFabricSchema = z.object({
  tags: fabricTagsSchema,
});

export const updateFabricSchema = z.object({
  tags: fabricTagsSchema,
});

export const listFabricsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  scope: z.enum(["all", "preset", "user"]).default("all"),
  search: z.string().trim().max(30).default(""),
});

export type CreateFabricInput = z.infer<typeof createFabricSchema>;
export type ListFabricsInput = z.infer<typeof listFabricsSchema>;
export type UpdateFabricInput = z.infer<typeof updateFabricSchema>;
