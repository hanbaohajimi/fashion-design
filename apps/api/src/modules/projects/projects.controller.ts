import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import {
  createProjectSchema,
  listProjectsSchema,
  updateProjectSchema,
} from "./projects.schemas";
import { ProjectsService } from "./projects.service";

const projectIdSchema = z.string().min(1).max(100);
const idempotencyKeySchema = z.string().trim().min(8).max(200);

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      message: result.error.issues[0]?.message ?? "请求参数无效",
    });
  }

  return result.data;
}

@Controller("projects")
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projectsService: ProjectsService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown>,
  ) {
    return this.projectsService.list(
      user.userId,
      parseOrThrow(listProjectsSchema, query),
    );
  }

  @Get(":id")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") projectId: string,
  ) {
    return this.projectsService.get(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
    );
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    return this.projectsService.create(
      user.userId,
      parseOrThrow(createProjectSchema, body),
      parseOrThrow(idempotencyKeySchema, idempotencyKey),
    );
  }

  @Patch(":id")
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") projectId: string,
    @Body() body: unknown,
  ) {
    return this.projectsService.update(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
      parseOrThrow(updateProjectSchema, body),
    );
  }

  @Post(":id/duplicate")
  duplicate(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") projectId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    return this.projectsService.duplicate(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
      parseOrThrow(idempotencyKeySchema, idempotencyKey),
    );
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") projectId: string,
  ) {
    return this.projectsService.remove(
      user.userId,
      parseOrThrow(projectIdSchema, projectId),
    );
  }
}
