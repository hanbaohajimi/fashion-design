import { BadRequestException, Body, Controller, Get, Header, Inject, Param, Patch } from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { DesignContextService } from "./design-context.service";
import { patchProjectDesignContextSchema } from "./design-context.schemas";

@Controller("projects/:projectId/design-context")
export class DesignContextController {
  constructor(@Inject(DesignContextService) private readonly contexts: DesignContextService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  get(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.contexts.get(user.userId, projectId);
  }

  @Patch()
  patch(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Body() body: unknown) {
    const parsed = patchProjectDesignContextSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ code: "VALIDATION_ERROR", message: z.prettifyError(parsed.error) });
    return this.contexts.patch(user.userId, projectId, parsed.data);
  }
}
