import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { AuditInterceptor } from "./audit.interceptor";

describe("AuditInterceptor", () => {
  it("关键写操作记录 userId、operation 与 resource", async () => {
    const create = vi.fn().mockResolvedValue({});
    const interceptor = new AuditInterceptor({
      auditLog: { create },
    } as never);
    const context = {
      getClass: () => class GenerationController {},
      getHandler: () => function createGeneration() {},
      switchToHttp: () => ({
        getRequest: () => ({
          auth: { userId: "user-a" },
          method: "POST",
          originalUrl: "/generations?debug=no",
          params: {},
        }),
        getResponse: () => ({ statusCode: 202 }),
      }),
    } as unknown as ExecutionContext;
    const next = { handle: () => of({ task_id: "task-a" }) } as CallHandler;

    await lastValueFrom(interceptor.intercept(context, next));

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: "GenerationController.createGeneration",
        resource: "generations",
        userId: "user-a",
      }),
    });
    expect(create.mock.calls[0]?.[0].data.path).toBe("/generations");
  });
});
