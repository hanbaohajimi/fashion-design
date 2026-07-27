import { BOARD_ELEMENT_ROLES } from "@fashion/shared";
import { z } from "zod";

export const projectIdSchema = z.string().min(1).max(100);
export const shapeIdSchema = z.string().min(1).max(200);
export const inferRoleSchema = z.object({
  fileId: z.string().min(1).max(100),
});
export const setElementRolesSchema = z.object({
  role: z.enum(BOARD_ELEMENT_ROLES),
  shapeIds: z.array(shapeIdSchema).min(1).max(100),
});

export type SetElementRolesInput = z.infer<typeof setElementRolesSchema>;
