import type { User } from "@fashion/db";
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { loginRequestSchema } from "./auth-request.schema";

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
import { BillingService } from "../billing/billing.service";
import { RateLimit, RateLimitGuard } from "../../security/rate-limit.guard";

// Login body validation is shared with the guard, before bucket selection.
const AUTH_CACHE_CONTROL = "private, no-store";

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(BillingService) private readonly billingService: BillingService,
  ) {}

  @Public()
  @Post("auth/login")
  @HttpCode(200)
  @Header("Cache-Control", AUTH_CACHE_CONTROL)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    keyBy: "login",
    limit: 5,
    name: "auth-login",
    windowSeconds: 60,
  })
  async login(
    @Body() body: unknown,
    @Headers("origin") origin: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ ok: true; projectId?: string; user?: User }> {
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
      const projectId = await this.authService.getInitialProjectId(
        session.user.id,
      );
      return {
        ok: true,
        user: session.user,
        ...(projectId ? { projectId } : {}),
      };
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

  @Public()
  @Post("auth/logout")
  @HttpCode(204)
  @Header("Cache-Control", AUTH_CACHE_CONTROL)
  logout(
    @Headers("origin") origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): void {
    this.authService.assertAllowedOrigin(origin);
    const commonOptions = this.getSessionCookieOptions();

    response.cookie(ACCESS_TOKEN_COOKIE, "", {
      ...commonOptions,
      maxAge: 0,
    });
    response.cookie(REFRESH_TOKEN_COOKIE, "", {
      ...commonOptions,
      maxAge: 0,
    });
  }

  @Get("me")
  @Header("Cache-Control", AUTH_CACHE_CONTROL)
  async getMe(@CurrentUser() authenticatedUser: AuthenticatedUser): Promise<{
    credits: { limit: number; remaining: number; used: number };
    user: User;
  }> {
    const user = await this.authService.getUser(authenticatedUser.userId);
    const quota = await this.billingService.canGenerate(user.id);

    return {
      user,
      credits: {
        limit: quota.limit,
        remaining: quota.remaining,
        used: quota.used,
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
    const commonOptions = this.getSessionCookieOptions();
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

  private getSessionCookieOptions(): {
    readonly httpOnly: true;
    readonly path: "/";
    readonly sameSite: "lax";
    readonly secure: boolean;
  } {
    return {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure:
        process.env.SESSION_COOKIE_SECURE === "true" ||
        process.env.NODE_ENV === "production",
    };
  }
}
