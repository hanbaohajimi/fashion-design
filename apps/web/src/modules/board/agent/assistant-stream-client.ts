import { SseDecoder, type AssistantStreamEvent, type AssistantTurnView } from "@fashion/shared";
import { privateFetch, privateRequestSignal } from "../../auth/private-fetch";

export type AssistantEventHandler = (event: AssistantStreamEvent) => void;
export async function sendAssistantTurn<T extends AssistantTurnView>(url: string, conversationId: string, input: { readonly clientRequestId: string }, onEvent?: AssistantEventHandler, requestSignal?: AbortSignal): Promise<T> {
  const signal = privateRequestSignal(requestSignal);
  let cursor = ""; let final: T | null = null;
  let response = await privateFetch(url, { method: "POST", credentials: "include", cache: "no-store", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(input), signal });
  for (let reconnect = 0; reconnect < 8; reconnect++) {
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: unknown } | null;
      throw new Error(typeof body?.message === "string" ? body.message : "设计消息发送或恢复失败，请读取消息状态后重试");
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) return await response.json() as T;
    if (!response.body) throw new Error("助手响应流不可用");
    const reader = response.body.getReader(); const decoder = new TextDecoder(); const sse = new SseDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        for (const frame of sse.push(decoder.decode(chunk.value, { stream: !chunk.done }))) {
          if (frame.event === "error") continue; // Recover the authoritative stored state below.
          const event = JSON.parse(frame.data) as AssistantStreamEvent;
          if (event.eventId === cursor && event.type !== "snapshot") continue;
          cursor = event.eventId;
          onEvent?.(event);
          if (event.type === "message.completed" || event.type === "message.failed" || event.type === "snapshot" && event.terminal) final = event.turn as T;
        }
        if (final || chunk.done) break;
      }
    } catch (error) { signal.throwIfAborted(); if (reconnect === 7) throw error; }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (final) return final;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, Math.min(2000, 250 * 2 ** reconnect));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    // Reconnect is always a read. The original POST is never retried here.
    response = await privateFetch(`/api/agent-conversations/${encodeURIComponent(conversationId)}/message-streams/${encodeURIComponent(input.clientRequestId)}/events`, { credentials: "include", cache: "no-store", headers: { Accept: "text/event-stream" }, signal });
  }
  throw new Error("连接暂时中断，请从消息历史恢复本轮结果");
}
