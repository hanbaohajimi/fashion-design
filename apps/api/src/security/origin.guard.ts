import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Request } from "express";

export function isAllowedOrigin(origin: string | undefined, allowed: string, production = process.env.NODE_ENV === "production"): boolean {
  if (!origin || origin === "null") return false;
  try {
    const candidate = new URL(origin);
    const target = new URL(allowed);
    if (candidate.origin !== origin || candidate.username || candidate.password) return false;
    if (candidate.origin === target.origin) return true;
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return !production && loopback.has(candidate.hostname) && loopback.has(target.hostname)
      && candidate.protocol === target.protocol && candidate.port === target.port;
  } catch { return false; }
}

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return true;
    const allowed = process.env.APP_ORIGIN?.trim();
    if (!allowed) throw new ServiceUnavailableException({ code: "ORIGIN_CONFIGURATION_ERROR", message: "请求来源保护未配置" });
    if (!isAllowedOrigin(request.get("origin"), allowed)) throw new ForbiddenException({ code: "INVALID_ORIGIN", message: "请求来源无效，请从设计工作室重新打开页面" });
    return true;
  }
}
