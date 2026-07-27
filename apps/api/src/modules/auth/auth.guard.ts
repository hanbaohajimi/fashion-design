import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { ACCESS_TOKEN_COOKIE, IS_PUBLIC_KEY } from "./auth.constants";
import { AuthFlowError } from "./auth.errors";
import { AuthService } from "./auth.service";
import type { AuthenticatedRequest } from "./auth.types";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const accessToken = request.cookies?.[ACCESS_TOKEN_COOKIE] as
      string | undefined;

    if (!accessToken) {
      throw new UnauthorizedException({
        code: "INVALID_TOKEN",
        message: "请先登录后再访问。",
      });
    }

    try {
      const authenticatedUser =
        await this.authService.authenticate(accessToken);
      (request as AuthenticatedRequest).auth = authenticatedUser;
      return true;
    } catch (error) {
      if (error instanceof AuthFlowError) {
        throw new UnauthorizedException({
          code: error.code,
          message: error.message,
        });
      }

      throw error;
    }
  }
}
