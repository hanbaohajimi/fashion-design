import { z } from "zod";

const fabricNameSchema = z
  .string()
  .trim()
  .min(1, "面料名称不能为空")
  .max(120, "面料名称不能超过 120 个字");

const fabricCategorySchema = z.enum([
  "cotton",
  "silk",
  "wool",
  "synthetic",
  "blend",
]);

const compositionSchema = z
  .record(
    z
      .string()
      .trim()
      .min(1, "成分名称不能为空")
      .max(50, "成分名称不能超过 50 个字"),
    z.number().finite().positive("成分占比必须大于 0").max(100),
  )
  .refine((value) => Object.keys(value).length > 0, {
    message: "至少需要填写一种成分",
  })
  .refine(
    (value) =>
      Math.abs(
        Object.values(value).reduce((total, percentage) => {
          return total + percentage;
        }, 0) - 100,
      ) < 0.000_001,
    { message: "成分占比总和必须等于 100%" },
  );

export const fabricAttributesSchema = z
  .object({
    composition: compositionSchema,
    drape: z.enum(["stiff", "moderate", "fluid"]).optional(),
    opacity: z.enum(["opaque", "semi", "sheer"]).optional(),
    seasonSuggestion: z
      .array(z.enum(["spring", "summer", "autumn", "winter"]))
      .max(4)
      .optional(),
    sheen: z.enum(["matte", "subtle", "glossy"]).optional(),
    stretch: z.enum(["none", "slight", "high"]).optional(),
    texture: z.enum(["smooth", "textured", "fuzzy"]).optional(),
    useCases: z
      .array(z.enum(["shirt", "dress", "outerwear", "pants", "skirt", "suit"]))
      .max(12)
      .optional(),
    weave: z.enum(["plain", "twill", "satin", "knit", "jacquard"]).optional(),
    weight: z.number().finite().positive().max(2_000).optional(),
    width: z.number().finite().positive().max(1_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.weight !== undefined ||
      value.drape !== undefined ||
      value.stretch !== undefined ||
      value.weave !== undefined ||
      value.opacity !== undefined ||
      value.sheen !== undefined ||
      value.texture !== undefined,
    { message: "克重、织法、垂坠度等物理属性至少填写一项" },
  );

export const createFabricSchema = z.object({
  attributes: fabricAttributesSchema,
  category: fabricCategorySchema,
  name: fabricNameSchema,
  subCategory: z.string().trim().min(1).max(80).optional(),
});

export const updateFabricSchema = z
  .object({
    attributes: fabricAttributesSchema.optional(),
    category: fabricCategorySchema.optional(),
    name: fabricNameSchema.optional(),
    subCategory: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .refine(
    (value) =>
      value.attributes !== undefined ||
      value.category !== undefined ||
      value.name !== undefined ||
      value.subCategory !== undefined,
    { message: "请至少提供一个需要更新的字段" },
  );

export const listFabricsSchema = z.object({
  category: fabricCategorySchema.optional(),
  composition: z.string().trim().min(1).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  maxWeight: z.coerce.number().finite().positive().max(2_000).optional(),
  minWeight: z.coerce.number().finite().nonnegative().max(2_000).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  season: z.enum(["spring", "summer", "autumn", "winter"]).optional(),
  scope: z.enum(["all", "preset", "user"]).default("all"),
  search: z.string().trim().max(120).default(""),
});

export type CreateFabricInput = z.infer<typeof createFabricSchema>;
export type FabricAttributes = z.infer<typeof fabricAttributesSchema>;
export type ListFabricsInput = z.infer<typeof listFabricsSchema>;
export type UpdateFabricInput = z.infer<typeof updateFabricSchema>;
