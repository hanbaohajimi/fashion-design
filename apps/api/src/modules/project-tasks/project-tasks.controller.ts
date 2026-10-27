import { BadRequestException, Controller, Get, Header, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ProjectTasksService } from "./project-tasks.service";

const querySchema = z.object({ group: z.enum(["active", "running", "attention", "ended"]).default("active"), cursor: z.string().max(1000).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) });
@Controller("projects/:projectId/tasks")
export class ProjectTasksController {
  constructor(@Inject(ProjectTasksService) private readonly tasks: ProjectTasksService) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Query() query: Record<string, unknown>) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success || !projectId || projectId.length > 128) throw new BadRequestException("任务查询参数无效");
    return this.tasks.list(user.userId, projectId, parsed.data);
  }
}
