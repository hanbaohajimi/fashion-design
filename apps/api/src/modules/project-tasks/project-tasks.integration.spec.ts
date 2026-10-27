import { prisma } from "@fashion/db";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ProjectTasksService } from "./project-tasks.service";
import { ProjectAccessPolicy } from "../studio/project-access.policy";

let ownerId = "";
let projectId = "";
let workspaceId = "";
let viewerId = "";
const service = new ProjectTasksService(prisma, new ProjectAccessPolicy(prisma));
beforeAll(async () => {
  const owner = await prisma.user.create({ data: { email: `tasks-${crypto.randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Task integration", projects: { create: { name: "Tasks" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
  ownerId = owner.id;
  const workspace = owner.ownedWorkspaces[0];
  const project = workspace?.projects[0];
  if (!workspace || !project) throw new Error("测试项目创建失败");
  workspaceId = workspace.id; projectId = project.id;
  const viewer = await prisma.user.create({ data: { email: `tasks-viewer-${crypto.randomUUID()}@example.com` } }); viewerId = viewer.id;
  await prisma.workspaceMember.create({ data: { workspaceId, userId: viewerId, role: "VIEWER" } });
  const date = new Date("2026-10-27T00:00:00.000Z");
  await prisma.generationTask.createMany({ data: Array.from({ length: 7 }, (_, index) => ({ userId: ownerId, projectId, taskType: "t2i", input: {}, status: index < 4 ? "RUNNING" as const : "FAILED" as const, createdAt: date })) });
  await prisma.exportJob.create({ data: { userId: ownerId, projectId, format: "PNG", quality: "STANDARD", watermark: false, createdAt: date } });
});
afterAll(async () => {
  if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
  if (viewerId) await prisma.user.delete({ where: { id: viewerId } });
});

it("跨领域同时间分页无重复遗漏，计数来自数据库", async () => {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await service.list(ownerId, projectId, { group: "active", limit: 2, ...(cursor ? { cursor } : {}) });
    expect(page.counts).toEqual({ running: 5, attention: 3 });
    ids.push(...page.items.map(item => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(ids).toHaveLength(8); expect(new Set(ids).size).toBe(8);
});
it("只读成员可读状态但无写入操作，项目外用户不可读取", async () => {
  const page = await service.list(viewerId, projectId, { group: "active", limit: 30 });
  expect(page.items.every(item => item.actions.length === 0)).toBe(true);
  const owner = await service.list(ownerId, projectId, { group: "running", limit: 30 });
  expect(owner.items.filter(item => item.domain === "generation").every(item => item.actions.some(action => action.kind === "cancel_generation"))).toBe(true);
  await expect(service.list(crypto.randomUUID(), projectId, { group: "active", limit: 30 })).rejects.toThrow();
});
it("拒绝非法游标", async () => {
  await expect(service.list(ownerId, projectId, { group: "active", limit: 30, cursor: "invalid" })).rejects.toThrow("游标无效");
});
