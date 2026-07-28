import * as Sentry from "@sentry/nestjs";
import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { finalize, tap, type Observable } from "rxjs";

export const SLOW_API_THRESHOLD_MS = 3_000;

@Injectable()
export class SlowApiInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = performance.now();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const operation = `${context.getClass().name}.${context.getHandler().name}`;
    let statusCode = response.statusCode;

    return next.handle().pipe(
      tap({
        complete: () => {
          statusCode = response.statusCode;
        },
        error: (error: unknown) => {
          statusCode =
            error instanceof HttpException ? error.getStatus() : 500;
        },
      }),
      finalize(() => {
        const durationMs = Math.round(performance.now() - startedAt);
        if (durationMs <= SLOW_API_THRESHOLD_MS) return;
        Sentry.withScope((scope) => {
          scope.setTag("method", request.method.toUpperCase());
          scope.setTag("operation", operation);
          scope.setTag("runtime", "api");
          scope.setTag("status_code", String(statusCode));
          scope.setContext("slow_api", {
            duration_ms: durationMs,
            threshold_ms: SLOW_API_THRESHOLD_MS,
          });
          Sentry.captureMessage("Slow API request", "warning");
        });
      }),
    );
  }
}
