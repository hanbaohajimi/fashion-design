import type { User } from "@fashion/db";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import {
  ACCESS_TOKEN_COOKIE,
  ACCESS_TOKEN_FALLBACK_MAX_AGE_MS,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE_MS,
} from "./auth.constants";
import { AuthFlowError } from "./auth.errors";
import { AuthService } from "./auth.service";
import type { AuthSession, AuthenticatedUser } from "./auth.types";
import { CurrentUser } from "./current-user.decorator";
import { Public } from "./public.decorator";

const loginRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((email) => email.toLowerCase()),
  }),
  z.object({
    action: z.literal("verify"),
    tokenHash: z.string().min(32).max(2048),
  }),
  z.object({
    action: z.literal("refresh"),
  }),
]);

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post("auth/login")
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Headers("origin") origin: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true; user?: User }> {
    try {
      this.authService.assertAllowedOrigin(origin);
      const parsed = loginRequestSchema.safeParse(body);

      if (!parsed.success) {
        throw new BadRequestException({
          code: "INVALID_REQUEST",
          message: "登录请求格式不正确。",
        });
      }

      if (parsed.data.action === "send") {
        await this.authService.sendMagicLink(parsed.data.email);
        return { ok: true };
      }

      const session =
        parsed.data.action === "verify"
          ? await this.authService.verifyMagicLink(parsed.data.tokenHash)
          : await this.refreshFromCookie(request);

      this.setSessionCookies(response, session);
      return { ok: true, user: session.user };
    } catch (error) {
      if (error instanceof AuthFlowError) {
        const Exception =
          error.code === "INVALID_TOKEN" || error.code === "TOKEN_EXPIRED"
            ? UnauthorizedException
            : BadRequestException;
        throw new Exception({
          code: error.code,
          message: error.message,
        });
      }

      throw error;
    }
  }

  @Get("me")
  async getMe(@CurrentUser() authenticatedUser: AuthenticatedUser): Promise<{
    credits: { limit: number; remaining: number; used: number };
    user: User;
  }> {
    const user = await this.authService.getUser(authenticatedUser.userId);

    return {
      user,
      credits: {
        limit: 0,
        remaining: 0,
        used: 0,
      },
    };
  }

  private async refreshFromCookie(request: Request): Promise<AuthSession> {
    const refreshToken = request.cookies?.[REFRESH_TOKEN_COOKIE] as
      string | undefined;

    if (!refreshToken) {
      throw new AuthFlowError("INVALID_TOKEN", "刷新凭证不存在，请重新登录。");
    }

    return this.authService.refreshSession(refreshToken);
  }

  private setSessionCookies(response: Response, session: AuthSession): void {
    const secure =
      process.env.SESSION_COOKIE_SECURE === "true" ||
      process.env.NODE_ENV === "production";
    const commonOptions = {
      httpOnly: true,
      path: "/",
      sameSite: "lax" as const,
      secure,
    };
    const accessMaxAge = session.expiresAt
      ? Math.max(session.expiresAt * 1000 - Date.now(), 1000)
      : ACCESS_TOKEN_FALLBACK_MAX_AGE_MS;

    response.cookie(ACCESS_TOKEN_COOKIE, session.accessToken, {
      ...commonOptions,
      maxAge: accessMaxAge,
    });
    response.cookie(REFRESH_TOKEN_COOKIE, session.refreshToken, {
      ...commonOptions,
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    });
  }
}
