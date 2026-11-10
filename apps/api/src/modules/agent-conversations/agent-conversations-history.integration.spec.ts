import { prisma } from "@fashion/db";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect, it, vi } from "vitest";
import { RateLimitGuard } from "../../security/rate-limit.guard";
import { ProjectAccessPolicy } from "../studio/project-access.policy";
import { ProjectAgentConversationsController } from "./agent-conversations.controller";
import { AgentConversationsService } from "./agent-conversations.service";

it("serves old conversation links through HTTP with real project, owner and archive isolation", async () => {
  const owner = await prisma.user.create({
    data: { email: `history-owner-${randomUUID()}@example.com`, ownedWorkspaces: { create: {
      name: "Conversation history verification", projects: { create: [{ name: "History A" }, { name: "History B" }] },
    } } }, include: { ownedWorkspaces: { include: { projects: true } } },
  });
  const member = await prisma.user.create({ data: { email: `history-viewer-${randomUUID()}@example.com` } });
  const workspace = owner.ownedWorkspaces[0];
  if (!workspace) throw new Error("Missing isolated test workspace");
  const [project, otherProject] = workspace.projects;
  if (!project || !otherProject) throw new Error("Missing isolated test projects");
  const model = { generateJson: vi.fn(() => { throw new Error("History must not call a model"); }) };
  const generation = { createFromAgent: vi.fn() };
  const service = new AgentConversationsService(prisma, model as never, generation as never, {} as never, undefined, undefined, new ProjectAccessPolicy(prisma));
  const module = await Test.createTestingModule({ controllers: [ProjectAgentConversationsController], providers: [{ provide: AgentConversationsService, useValue: service }] })
    .overrideGuard(RateLimitGuard).useValue({ canActivate: () => true }).compile();
  const app = module.createNestApplication();
  app.use((req: { auth: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => { req.auth = { userId: req.headers["x-test-user"] }; next(); });
  await app.init();
  try {
    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: member.id, role: "VIEWER" } });
    const older = await prisma.agentConversation.create({ data: {
      projectId: project.id, createdById: owner.id, title: "历史风衣方案", mode: "workflow", updatedAt: new Date("2020-01-01"),
    } });
    await prisma.agentConversation.createMany({ data: Array.from({ length: 50 }, (_, i) => ({
      projectId: project.id, createdById: owner.id, title: `后续对话 ${i}`, mode: "workflow",
    })) });
    const personal = await prisma.agentConversation.create({ data: { projectId: project.id, createdById: member.id, title: "成员自己的旧对话", mode: "workflow" } });
    const get = (path: string, userId = owner.id) => request(app.getHttpServer()).get(path).set("x-test-user", userId);
    const path = `/projects/${project.id}/agent-conversations`;
    const first = await get(`${path}?limit=50`).expect(200);
    expect(first.body.items).toHaveLength(50);
    expect(first.body.items.some((item: { id: string }) => item.id === older.id)).toBe(false);
    const second = await get(`${path}?limit=50&cursor=${first.body.nextCursor}`).expect(200);
    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([older.id]);
    expect(second.body.nextCursor).toBeNull();
    const linked = await get(`${path}/${older.id}`).expect(200);
    expect(linked.body).toMatchObject({ id: older.id, projectId: project.id, title: "历史风衣方案", mode: "workflow" });
    await get(`/projects/${otherProject.id}/agent-conversations/${older.id}`).expect(404);
    await get(`${path}/${older.id}`, member.id).expect(404);
    await get(`${path}/${personal.id}`, member.id).expect(200);
    await get(`${path}/does-not-exist`).expect(404);
    await prisma.agentConversation.update({ where: { id: older.id }, data: { archivedAt: new Date() } });
    await get(`${path}/${older.id}`).expect(404);
    await prisma.workspaceMember.deleteMany({ where: { workspaceId: workspace.id, userId: member.id } });
    await get(`${path}/${personal.id}`, member.id).expect(403);
    expect(await prisma.agentConversation.count({ where: { projectId: project.id } })).toBe(52);
    expect(model.generateJson).not.toHaveBeenCalled();
    expect(generation.createFromAgent).not.toHaveBeenCalled();
  } finally {
    await app.close();
    await prisma.agentConversation.deleteMany({ where: { projectId: { in: workspace.projects.map(item => item.id) } } });
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.user.delete({ where: { id: member.id } });
  }
});
