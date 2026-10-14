import { BadRequestException, Body, Controller, Get, Inject, Param, Patch } from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { workflowPatchSchema } from "./workflows.schemas";
import { WorkflowsService } from "./workflows.service";

const projectIdSchema = z.string().trim().min(1).max(100);

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "工作流请求无效",
    });
  }
  return result.data;
}

@Controller("projects/:projectId/workflow")
export class WorkflowsController {
  constructor(@Inject(WorkflowsService) private readonly workflows: WorkflowsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.workflows.get(user.userId, parseOrThrow(projectIdSchema, projectId));
  }

  @Patch()
  patch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.workflows.patch(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
      parseOrThrow(workflowPatchSchema, body),
    );
  }
}
