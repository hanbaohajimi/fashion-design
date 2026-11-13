import { BadRequestException, Body, Controller, Delete, Get, Header, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { Public } from "../auth/public.decorator";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import { StudioSharesService } from "./studio-shares.service";

@Controller("projects/:projectId/studio/shares")
export class StudioSharesController {
  constructor(private readonly service: StudioSharesService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  list(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string) {
    return this.service.list(user.userId, projectId);
  }

  @Post()
  @Header("Cache-Control", "private, no-store")
  create(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Body() body: unknown) {
    return this.service.create(user.userId, projectId, body);
  }

  @Delete(":id")
  @Header("Cache-Control", "private, no-store")
  revoke(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Param("id") id: string) {
    return this.service.revoke(user.userId, projectId, id);
  }

  @Post(":id/rotate")
  @Header("Cache-Control", "private, no-store")
  rotate(@CurrentUser() user: AuthenticatedUser, @Param("projectId") projectId: string, @Param("id") id: string) {
    return this.service.rotate(user.userId, projectId, id);
  }
}

@Controller("studio-shares")
export class PublicStudioSharesController {
  constructor(private readonly service: StudioSharesService) {}

  @Public()
  @Get(":token")
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  publicView(@Param("token") token: string) {
    return this.service.publicView(token);
  }

  @Public()
  @Post(":token/reviews")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    keyBy: "publicShare",
    limit: 40,
    ipLimit: 120,
    name: "studio-public-review",
    windowSeconds: 60 * 60,
  })
  @Header("Cache-Control", "no-store")
  addReview(@Param("token") token: string, @Headers("idempotency-key") key: string | undefined, @Body() body: unknown) {
    const parsed = z.string().trim().min(8).max(200).safeParse(key);
    if (!parsed.success) throw new BadRequestException("缺少有效的评审请求编号");
    return this.service.addPublicReview(token, body, parsed.data);
  }
}

