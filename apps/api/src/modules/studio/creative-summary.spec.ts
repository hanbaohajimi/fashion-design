import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { StudioService } from "./studio.service";
describe("首页创作摘要", () => {
  it("只读取项目计数，不加载图片和修订正文", async () => {
    const database = { style: { count: vi.fn().mockResolvedValue(2) }, designAsset: { count: vi.fn().mockResolvedValue(5) }, studioDocument: { count: vi.fn().mockResolvedValue(1) } };
    const require = vi.fn().mockResolvedValue({});
    const service = new StudioService(database as never, { require } as never);
    expect(await service.creativeSummary("member", "project")).toEqual({ styles: 2, assets: 5, packs: 1 });
    expect(require).toHaveBeenCalledWith("member", "project", "read");
    expect(database.designAsset.count).toHaveBeenCalledWith({ where: { projectId: "project", archivedAt: null } });
  });
  it("无权访问时不查询项目数据", async () => {
    const count = vi.fn();
    const service = new StudioService({ style: { count } } as never, { require: vi.fn().mockRejectedValue(new ForbiddenException()) } as never);
    await expect(service.creativeSummary("removed", "project")).rejects.toBeInstanceOf(ForbiddenException);
    expect(count).not.toHaveBeenCalled();
  });
});
