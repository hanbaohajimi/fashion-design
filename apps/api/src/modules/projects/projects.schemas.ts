import { z } from "zod";

const projectName = z
  .string()
  .trim()
  .min(3, "项目名称至少需要 3 个字")
  .max(80, "项目名称不能超过 80 个字");

export const createProjectSchema = z.object({
  name: projectName,
});

export const updateProjectSchema = z
  .object({
    archived: z.boolean().optional(),
    name: projectName.optional(),
  })
  .refine((value) => value.archived !== undefined || value.name !== undefined, {
    message: "请至少提供一个需要更新的字段",
  });

export const listProjectsSchema = z.object({
  archived: z.enum(["active", "archived", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(50).default(50),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  search: z.string().trim().max(80).default(""),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type ListProjectsInput = z.infer<typeof listProjectsSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
