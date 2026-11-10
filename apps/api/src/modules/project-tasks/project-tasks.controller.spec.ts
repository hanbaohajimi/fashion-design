import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ProjectTasksController } from "./project-tasks.controller";

describe("活动摘要查询参数", () => {
  it("仅在 activity=1 时请求摘要，保留原查询默认值", () => {
    const service = { list: vi.fn() };
    const controller = new ProjectTasksController(service as never);
    controller.list({ userId: "u" } as never, "p", { activity: "1", limit: "2", group: "ended" });
    expect(service.list).toHaveBeenLastCalledWith("u", "p", { activity: true, limit: 2, group: "ended" });
    controller.list({ userId: "u" } as never, "p", {});
    expect(service.list).toHaveBeenLastCalledWith("u", "p", { limit: 30, group: "active" });
    for (const activity of ["true", "0", ["1", "1"]]) expect(() => controller.list({ userId: "u" } as never, "p", { activity })).toThrow(BadRequestException);
  });
});
