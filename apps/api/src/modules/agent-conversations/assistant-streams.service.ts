import { createHash, randomUUID } from "node:crypto";
import { ConflictException, Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Redis } from "ioredis";
import type { Response } from "express";
import type { AssistantStreamEvent, AssistantStreamObserver, AssistantStreamPayload, AssistantTurnView } from "@fashion/shared";

export const ASSISTANT_STREAM_REDIS = Symbol("ASSISTANT_STREAM_REDIS");
const TTL = 24 * 60 * 60;
type Snapshot = { turn: AssistantTurnView; text: string; terminal: boolean; attemptId: string; eventId: string };
const terminal = (turn: AssistantTurnView) => turn.assistantMessage.status !== "pending";

@Injectable()
export class AssistantStreamsService implements OnModuleDestroy {
  private readonly logger = new Logger(AssistantStreamsService.name);
  constructor(@Inject(ASSISTANT_STREAM_REDIS) private readonly redis: Redis) {}
  onModuleDestroy() { this.redis.disconnect(); }
  enabled(accept: string | undefined) { return process.env.ASSISTANT_STREAMING_ENABLED === "true" && Boolean(accept?.includes("text/event-stream")); }
  private key(conversationId: string, requestId: string) { return `assistant-stream:${encodeURIComponent(conversationId)}:${encodeURIComponent(requestId)}`; }
  private async ready() { if (this.redis.status === "wait") await this.redis.connect(); if (this.redis.status !== "ready") throw new Error("Redis unavailable"); }
  private open(response: Response) {
    response.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" });
    response.flushHeaders();
  }
  private write(response: Response, event: AssistantStreamEvent) {
    if (response.destroyed || response.writableEnded) return;
    if (response.writableLength > 1_000_000) { response.destroy(); return; }
    response.write(`id: ${event.eventId}\nevent: assistant\ndata: ${JSON.stringify(event)}\n\n`);
  }

  async start(response: Response, conversationId: string, requestId: string, run: (observer?: AssistantStreamObserver) => Promise<AssistantTurnView>, recover: () => Promise<AssistantTurnView>, requestBody = "") {
    const key = this.key(conversationId, requestId);
    const attemptId = randomUUID();
    try {
      await this.ready();
      const fingerprint = createHash("sha256").update(requestBody).digest("hex");
      await this.redis.set(`${key}:request`, fingerprint, "EX", TTL, "NX");
      if (await this.redis.get(`${key}:request`) !== fingerprint) throw new ConflictException("请求编号已用于不同内容或引用");
      const claimed = await this.redis.set(`${key}:lock`, attemptId, "EX", 15 * 60 + 30, "NX");
      if (!claimed) { await this.follow(response, conversationId, requestId, undefined, recover); return; }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // Never repeat a model call merely because streaming infrastructure is unavailable.
      response.json(await run()); return;
    }
    this.open(response);
    const heartbeat = setInterval(() => { if (!response.destroyed && !response.writableEnded) response.write(": heartbeat\n\n"); }, 10_000);
    let state: Snapshot | null = null;
    let fallbackSequence = 0;
    const publish = async (payload: AssistantStreamPayload) => {
      if (payload.type === "accepted") state = { turn: payload.turn, text: "", terminal: false, attemptId, eventId: "0-0" };
      if (!state) return;
      if (payload.type === "message.delta") state.text += payload.text;
      if (payload.type === "message.reset") state.text = "";
      if (payload.type === "message.completed" || payload.type === "message.failed") { state.turn = payload.turn; state.terminal = true; state.text = payload.turn.assistantMessage.content; }
      const base = { ...payload, attemptId, messageId: state.turn.assistantMessage.id };
      let eventId = `${Date.now()}-${++fallbackSequence}`;
      try {
        // The producer owns this lease. A superseded attempt cannot replace a newer snapshot.
        if (await this.redis.get(`${key}:lock`) !== attemptId) return;
        const id = await this.redis.xadd(key, "MAXLEN", "=", 10000, "*", "event", JSON.stringify(base));
        if (id) eventId = id;
        state.eventId = eventId;
        await this.redis.multi().set(`${key}:snapshot`, JSON.stringify(state), "EX", TTL).expire(key, TTL).exec();
      } catch { this.logger.warn("助手流缓存不可用；最终结果继续保存到数据库"); }
      this.write(response, { ...base, eventId });
    };
    const observer: AssistantStreamObserver = {
      accepted: (turn) => publish({ type: "accepted", turn }),
      delta: (text) => publish({ type: "message.delta", text }),
      reset: () => publish({ type: "message.reset" }),
      phase: (phase) => publish({ type: "phase", phase }),
    };
    try {
      const result = await run(observer);
      if (!state) await observer.accepted(result);
      await publish({ type: result.assistantMessage.status === "failed" ? "message.failed" : "message.completed", turn: result });
    } catch (error) {
      this.logger.warn("助手流请求未完成，客户端可通过消息历史恢复");
      try { const result = await recover(); if (!state) await observer.accepted(result); await publish({ type: "message.failed", turn: result }); } catch { /* Original failure may precede message reservation. */ }
      if (!response.destroyed) response.write(`event: error\ndata: ${JSON.stringify({ message: "本轮未完成，请读取消息状态后重试" })}\n\n`);
      void error;
    } finally {
      clearInterval(heartbeat);
      await this.redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end return 0", 1, `${key}:lock`, attemptId).catch(() => undefined);
      if (!response.destroyed) response.end();
    }
  }

  async follow(response: Response, conversationId: string, requestId: string, after: string | undefined, recover: () => Promise<AssistantTurnView>, authorize?: () => Promise<unknown>) {
    this.open(response);
    const key = this.key(conversationId, requestId);
    let cursor = after && /^\d+-\d+$/u.test(after) ? after : "0-0";
    let stopped = false; let ticks = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    response.on("close", () => { stopped = true; clearTimeout(timer); });
    const tick = async () => {
      if (stopped) return;
      try {
        if (ticks++ % 40 === 0) await authorize?.();
        await this.ready();
        const raw = await this.redis.get(`${key}:snapshot`);
        const snapshot = raw ? JSON.parse(raw) as Snapshot : null;
        const first = await this.redis.xrange(key, "-", "+", "COUNT", 1);
        const expiredCursor = first[0] && compareCursor(cursor, first[0][0]) < 0;
        if (snapshot && (cursor === "0-0" || expiredCursor)) {
          this.write(response, { type: "snapshot", ...snapshot, messageId: snapshot.turn.assistantMessage.id }); cursor = snapshot.eventId;
          if (snapshot.terminal) { response.end(); return; }
        } else {
          const events = await this.redis.xrange(key, `(${cursor}`, "+", "COUNT", 100);
          for (const [id, fields] of events) {
            const event = { ...JSON.parse(fields[1] ?? "{}"), eventId: id } as AssistantStreamEvent;
            this.write(response, event); cursor = id;
            if (event.type === "message.completed" || event.type === "message.failed") { response.end(); return; }
          }
        }
        if (!snapshot || ticks % 40 === 1) {
          const turn = await recover();
          if (terminal(turn)) { this.write(response, { type: "snapshot", turn, text: turn.assistantMessage.content, terminal: true, eventId: `${Date.now()}-0`, attemptId: "stored", messageId: turn.assistantMessage.id }); response.end(); return; }
        }
        if (ticks % 40 === 0) response.write(": heartbeat\n\n");
      } catch {
        try {
          await authorize?.();
          const turn = await recover();
          if (terminal(turn)) { this.write(response, { type: "snapshot", turn, text: turn.assistantMessage.content, terminal: true, eventId: `${Date.now()}-0`, attemptId: "stored", messageId: turn.assistantMessage.id }); response.end(); return; }
        } catch { response.end(); return; }
      }
      if (!stopped) timer = setTimeout(() => { void tick(); }, 250);
    };
    await tick();
  }
}
function compareCursor(a: string, b: string) {
  const [at = 0n, as = 0n] = a.split("-").map(BigInt); const [bt = 0n, bs = 0n] = b.split("-").map(BigInt);
  return at === bt ? as < bs ? -1 : as > bs ? 1 : 0 : at < bt ? -1 : 1;
}
