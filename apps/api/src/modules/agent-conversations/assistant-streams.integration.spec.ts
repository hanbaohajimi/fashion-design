import "reflect-metadata";
import { prisma } from "@fashion/db";
import { SseDecoder, type AssistantStreamEvent } from "@fashion/shared";
import type { AmuxClaudeJsonClient, AmuxClaudeJsonRequest } from "@fashion/ai";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentConversationsController } from "./agent-conversations.controller";
import { AgentConversationsService } from "./agent-conversations.service";
import { AssistantStreamsService } from "./assistant-streams.service";
import { WorkflowAssistantController } from "../workflow-runtime/workflow-assistant.controller";
import { WorkflowAssistantService } from "../workflow-runtime/workflow-assistant.service";
import { WorkflowRuntimeService } from "../workflow-runtime/workflow-runtime.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { DesignContextService } from "../design-context/design-context.service";
import { RateLimitGuard } from "../../security/rate-limit.guard";
import type { AuthenticatedRequest } from "../auth/auth.types";

function collect(response: Response) {
  const events: AssistantStreamEvent[] = []; const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing SSE body");
  const sse = new SseDecoder(); const decoder = new TextDecoder();
  const finished = (async () => {
    try {
      while (true) { const chunk = await reader.read(); for (const frame of sse.push(decoder.decode(chunk.value, { stream: !chunk.done }))) if (frame.event === "assistant") events.push(JSON.parse(frame.data) as AssistantStreamEvent); if (chunk.done) break; }
    } finally { reader.releaseLock(); }
  })();
  return { events, finished, cancel: () => reader.cancel() };
}

describe("助手 SSE / PostgreSQL / Redis 联调", () => {
  let app: INestApplication; let second: INestApplication; let ownerId: string; let workflowId: string; let legacyId: string;
  let origin: string; let secondOrigin: string;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let modelGate = gate;
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const redis2 = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const streams = new AssistantStreamsService(redis);
  const streams2 = new AssistantStreamsService(redis2);
  const reply = { kind: "reply", message: "亚麻适合夏季设计。", plan: null, objectiveUpdate: null, preferences: [] };
  const decision = (name: string) => name === "fashion_agent_decision" ? { action: "reply", message: reply.message, generation: null } : reply;
  const model = {
    generateJson: vi.fn(async (request: AmuxClaudeJsonRequest<unknown>) => request.parse(decision(request.schemaName))),
    streamJson: vi.fn(async (request: AmuxClaudeJsonRequest<unknown>, delta: (update: { text: string; kind: string | null }) => Promise<void>) => {
      await delta({ text: "亚麻", kind: "reply" }); await modelGate;
      await delta({ text: reply.message, kind: "reply" }); return request.parse(decision(request.schemaName));
    }),
  };
  const generation = { createFromAgent: vi.fn() };
  beforeAll(async () => {
    vi.stubEnv("ASSISTANT_STREAMING_ENABLED", "true");
    const owner = await prisma.user.create({ data: { email: `stream-${crypto.randomUUID()}@example.com`, ownedWorkspaces: { create: { name: "Stream integration", projects: { create: { name: "Streaming" } } } } }, include: { ownedWorkspaces: { include: { projects: true } } } });
    ownerId = owner.id; const project = owner.ownedWorkspaces[0]?.projects[0]; if (!project) throw new Error("Missing project");
    workflowId = (await prisma.agentConversation.create({ data: { projectId: project.id, createdById: ownerId, mode: "workflow", title: "流式测试" } })).id;
    legacyId = (await prisma.agentConversation.create({ data: { projectId: project.id, createdById: ownerId, mode: "legacy", title: "流式历史测试" } })).id;
    const workflows = new WorkflowsService(prisma); const contexts = new DesignContextService(prisma, workflows);
    const visual = { enrich: vi.fn(async () => ({ index: [], images: [], imageBindings: [], coverage: { total: 0, ready: 0, pending: 0, failed: 0, attachedNodeIds: [], unreadNodeIds: [] } })) };
    const runtime = new WorkflowRuntimeService(prisma, workflows, generation as never, model as AmuxClaudeJsonClient, {} as never, {} as never);
    const assistant = new WorkflowAssistantService(prisma, workflows, runtime, contexts, visual as never, model as AmuxClaudeJsonClient);
    const conversations = new AgentConversationsService(prisma, model as AmuxClaudeJsonClient, generation as never, {} as never, undefined, assistant);
    const create = async (streamService: AssistantStreamsService) => {
      const module = await Test.createTestingModule({ controllers: [AgentConversationsController, WorkflowAssistantController], providers: [
        { provide: AgentConversationsService, useValue: conversations }, { provide: WorkflowAssistantService, useValue: assistant }, { provide: AssistantStreamsService, useValue: streamService },
      ] }).overrideGuard(RateLimitGuard).useValue({ canActivate: () => true }).compile();
      const instance = module.createNestApplication({ logger: false });
      instance.use((request: AuthenticatedRequest, _response: unknown, next: () => void) => { request.auth = { userId: String(request.headers["x-test-user"] ?? ownerId), email: "stream@example.com", authUserId: "integration" }; next(); });
      await instance.listen(process.env.ASSISTANT_PROXY_ORIGIN && streamService === streams ? 3001 : 0, "127.0.0.1"); return instance;
    };
    app = await create(streams); second = await create(streams2); origin = await app.getUrl(); secondOrigin = await second.getUrl();
  }, 30_000);
  afterAll(async () => {
    release(); await app?.close(); await second?.close(); streams.onModuleDestroy(); streams2.onModuleDestroy();
    const cleanup = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
    for (const id of [workflowId, legacyId]) { if (!id) continue; const keys = await cleanup.keys(`assistant-stream:${id}:*`); if (keys.length) await cleanup.del(...keys); }
    await cleanup.quit();
    if (ownerId) await prisma.user.delete({ where: { id: ownerId } });
    vi.unstubAllEnvs();
  });
  it("delivers partial text before commit, reconnects across instances and never repeats the model call", async () => {
    const clientRequestId = crypto.randomUUID();
    const input = { clientRequestId, content: "说明亚麻", referencedNodeIds: [] };
    const url = `/agent-conversations/${workflowId}`;
    const first = collect(await fetch(`${origin}${url}/workflow-messages`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(input) }));
    await vi.waitFor(() => expect(first.events.some((event) => event.type === "message.delta")).toBe(true));
    const reserved = await prisma.agentMessage.findUniqueOrThrow({ where: { conversationId_clientRequestId: { conversationId: workflowId, clientRequestId } }, include: { reply: true } });
    expect(reserved.reply?.status).toBe("PENDING");
    expect(first.events.some((event) => event.type === "message.completed")).toBe(false);
    const duplicate = collect(await fetch(`${origin}${url}/workflow-messages`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(input) }));
    await vi.waitFor(() => expect(duplicate.events.some((event) => event.type === "snapshot")).toBe(true));
    await duplicate.cancel(); await duplicate.finished;
    expect(model.streamJson).toHaveBeenCalledTimes(1);
    const conflict = await fetch(`${origin}${url}/workflow-messages`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ ...input, content: "different request" }) });
    expect(conflict.status).toBe(409);
    await first.cancel(); await first.finished;
    const resumed = collect(await fetch(`${secondOrigin}${url}/message-streams/${clientRequestId}/events`));
    await vi.waitFor(() => expect(resumed.events[0]?.type).toBe("snapshot"));
    expect(resumed.events[0]).toMatchObject({ text: "亚麻", terminal: false });
    release(); await resumed.finished;
    const completed = resumed.events.find((event) => event.type === "message.completed");
    expect(completed && "turn" in completed ? completed.turn.assistantMessage.content : null).toBe(reply.message);
    expect(model.streamJson).toHaveBeenCalledTimes(1); expect(generation.createFromAgent).not.toHaveBeenCalled();
    expect(await prisma.agentMessage.count({ where: { conversationId: workflowId } })).toBe(2);
    const denied = await fetch(`${secondOrigin}${url}/message-streams/${clientRequestId}/events`, { headers: { "x-test-user": crypto.randomUUID() } });
    expect([403, 404]).toContain(denied.status);
  }, 30_000);
  it("streams legacy replies and preserves JSON fallback", async () => {
    const input = { clientRequestId: crypto.randomUUID(), content: "说明亚麻", fileAssetIds: [], shapeIds: [] };
    const url = `${origin}/agent-conversations/${legacyId}/messages`;
    const stream = collect(await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(input) }));
    await stream.finished;
    expect(stream.events.some((event) => event.type === "message.delta")).toBe(true);
    expect(stream.events.at(-1)?.type).toBe("message.completed");
    vi.stubEnv("ASSISTANT_STREAMING_ENABLED", "false");
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ ...input, clientRequestId: crypto.randomUUID() }) });
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ assistantMessage: { content: reply.message, status: "completed" } });
  });
  it.runIf(Boolean(process.env.ASSISTANT_PROXY_ORIGIN))("browser receives a delta through the real Next.js proxy before database completion", async () => {
    vi.stubEnv("ASSISTANT_STREAMING_ENABLED", "true");
    let finish: () => void = () => undefined;
    modelGate = new Promise<void>((resolve) => { finish = resolve; });
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch(); const page = await browser.newPage();
    const requestId = crypto.randomUUID();
    try {
      await page.goto(`${process.env.ASSISTANT_PROXY_ORIGIN}/login`);
      const pending = page.evaluate(async ({ conversation, request }) => {
        const response = await fetch(`/api/agent-conversations/${conversation}/workflow-messages`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ clientRequestId: request, content: "说明亚麻", referencedNodeIds: [] }) });
        const reader = response.body?.getReader(); if (!reader) throw new Error("Missing browser stream");
        const decoder = new TextDecoder(); let received = "";
        (window as unknown as { received: string }).received = received;
        while (true) { const chunk = await reader.read(); received += decoder.decode(chunk.value, { stream: !chunk.done }); (window as unknown as { received: string }).received = received; if (chunk.done) break; }
        return received;
      }, { conversation: workflowId, request: requestId });
      await vi.waitFor(async () => expect(await page.evaluate(() => (window as unknown as { received?: string }).received ?? "")).toContain("message.delta"), { timeout: 12_000 });
      const row = await prisma.agentMessage.findUniqueOrThrow({ where: { conversationId_clientRequestId: { conversationId: workflowId, clientRequestId: requestId } }, include: { reply: true } });
      expect(row.reply?.status).toBe("PENDING");
      finish(); expect(await pending).toContain("message.completed");
    } finally { finish(); await browser.close(); }
  }, 30_000);
});
