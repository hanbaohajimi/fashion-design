import { fabricDetailsSchema } from "@fashion/shared";
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
  details: fabricDetailsSchema.nullable().optional(),
});

export const updateFabricSchema = z.object({
  tags: fabricTagsSchema.optional(),
  details: fabricDetailsSchema.nullable().optional(),
}).refine((input) => input.tags !== undefined || input.details !== undefined, "请填写需要更新的标签或档案");

export const listFabricsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  scope: z.enum(["all", "preset", "user"]).default("all"),
  search: z.string().trim().max(120).default(""),
  category: z.string().trim().min(1).max(80).optional(),
  fiber: z.string().trim().min(1).max(60).optional(),
  supplier: z.string().trim().min(1).max(160).optional(),
  minWeightGsm: z.coerce.number().finite().min(0).max(10_000).optional(),
  maxWeightGsm: z.coerce.number().finite().positive().max(10_000).optional(),
}).refine((input) => input.minWeightGsm === undefined || input.maxWeightGsm === undefined || input.minWeightGsm <= input.maxWeightGsm, "最低克重不能大于最高克重");

export type CreateFabricInput = z.infer<typeof createFabricSchema>;
export type ListFabricsInput = z.infer<typeof listFabricsSchema>;
export type UpdateFabricInput = z.infer<typeof updateFabricSchema>;
