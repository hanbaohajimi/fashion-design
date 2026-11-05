import { BadRequestException, Body, Controller, Get, Header, Headers, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { realtimeTryOnCaptureSchema, realtimeTryOnCreateSchema, realtimeTryOnEndSchema, realtimeTryOnObservationSchema } from "@fashion/shared";
import { z } from "zod";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";
import { RealtimeTryOnService } from "./realtime-tryon.service";
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException({ code: "TRYON_INVALID_REQUEST", message: "实时试穿请求格式无效" });
  return result.data;
}
const keySchema = z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/u);
const idSchema = z.string().min(1).max(100);
@Controller("realtime-tryon")
export class RealtimeTryOnController {
  constructor(@Inject(RealtimeTryOnService) private readonly service: RealtimeTryOnService) {}
  @Get("capabilities")
  @Header("Cache-Control", "private, no-store")
  capabilities(@CurrentUser() user: AuthenticatedUser) { return this.service.capabilities(user.userId); }
  @Post("sessions")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "tryon-issue", keyBy: "user", limit: 3, windowSeconds: 60 })
  create(@CurrentUser() user: AuthenticatedUser, @Headers("idempotency-key") key: unknown, @Body() body: unknown) { return this.service.create(user.userId, parse(keySchema, key), parse(realtimeTryOnCreateSchema, body)); }
  @Post("sessions/:id/observations")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "tryon-observe", keyBy: "user", limit: 60, windowSeconds: 60 })
  observe(@CurrentUser() user: AuthenticatedUser, @Param("id") id: unknown, @Body() body: unknown) { return this.service.observe(user.userId, parse(idSchema, id), parse(realtimeTryOnObservationSchema, body)); }
  @Post("sessions/:id/end")
  @Header("Cache-Control", "private, no-store")
  end(@CurrentUser() user: AuthenticatedUser, @Param("id") id: unknown, @Body() body: unknown) { return this.service.end(user.userId, parse(idSchema, id), parse(realtimeTryOnEndSchema, body).reason); }
  @Post("sessions/:id/captures")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "tryon-capture", keyBy: "user", limit: 20, windowSeconds: 60 })
  capture(@CurrentUser() user: AuthenticatedUser, @Param("id") id: unknown, @Headers("idempotency-key") key: unknown, @Body() body: unknown) { return this.service.capture(user.userId, parse(idSchema, id), parse(keySchema, key), parse(realtimeTryOnCaptureSchema, body)); }
}
