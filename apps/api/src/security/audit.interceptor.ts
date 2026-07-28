import type { PrismaClient } from "@fashion/db";
import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  catchError,
  from,
  mergeMap,
  type Observable,
  throwError,
} from "rxjs";

import type { AuthenticatedRequest } from "../modules/auth/auth.types";

export const AUDIT_DB = Symbol("AUDIT_DB");

type AuditDatabase = Pick<PrismaClient, "auditLog">;

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(AUDIT_DB) private readonly database: AuditDatabase) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>() as AuthenticatedRequest;
    const response = http.getResponse<Response>();
    const method = request.method.toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      return next.handle();
    }

    const operation = `${context.getClass().name}.${context.getHandler().name}`;
    const path = this.safePath(request);
    const resource = path.split("/").filter(Boolean)[0] ?? "unknown";
    const resourceId = this.resourceId(request);

    return next.handle().pipe(
      mergeMap((value) =>
        from(
          this.record({
            method,
            operation,
            path,
            resource,
            statusCode: response.statusCode,
            success: true,
            ...(resourceId ? { resourceId } : {}),
            ...(request.auth?.userId ? { userId: request.auth.userId } : {}),
          }).then(() => value),
        ),
      ),
      catchError((error: unknown) =>
        from(
          this.record({
            method,
            operation,
            path,
            resource,
            statusCode:
              error instanceof HttpException ? error.getStatus() : 500,
            success: false,
            ...(resourceId ? { resourceId } : {}),
            ...(request.auth?.userId ? { userId: request.auth.userId } : {}),
          }),
        ).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private async record(data: {
    readonly method: string;
    readonly operation: string;
    readonly path: string;
    readonly resource: string;
    readonly resourceId?: string;
    readonly statusCode: number;
    readonly success: boolean;
    readonly userId?: string;
  }): Promise<void> {
    try {
      await this.database.auditLog.create({
        data: {
          method: data.method,
          operation: data.operation,
          path: data.path,
          resource: data.resource,
          statusCode: data.statusCode,
          success: data.success,
          ...(data.resourceId ? { resourceId: data.resourceId } : {}),
          ...(data.userId ? { userId: data.userId } : {}),
        },
      });
    } catch (error) {
      console.error("审计日志写入失败", {
        operation: data.operation,
        statusCode: data.statusCode,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  private safePath(request: Request): string {
    const path = request.originalUrl.split("?")[0] || "/";
    return path.slice(0, 500);
  }

  private resourceId(request: Request): string | undefined {
    for (const name of [
      "id",
      "taskId",
      "fileId",
      "projectId",
      "collectionId",
      "assetId",
    ]) {
      const value = request.params[name];
      if (typeof value === "string" && value.length <= 128) {
        return value;
      }
    }
    return undefined;
  }
}
