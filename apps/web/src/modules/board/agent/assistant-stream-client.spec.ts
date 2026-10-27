import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAssistantTurn } from "./assistant-stream-client";
import type { AssistantStreamEvent, AssistantTurnView } from "@fashion/shared";
import { setPrivateRequestUser } from "../../auth/private-fetch";
afterEach(() => vi.unstubAllGlobals());
const message = { id: "assistant", role: "assistant", status: "completed", content: "完成", context: null, clientRequestId: null, replyToId: "user", generationTaskId: null, error: null, createdAt: "", updatedAt: "" } as const;
const turn: AssistantTurnView = { userMessage: { ...message, id: "user", role: "user" }, assistantMessage: message };
const encode = (event: AssistantStreamEvent) => `id: ${event.eventId}\nevent: assistant\ndata: ${JSON.stringify(event)}\n\n`;
describe("助手流请求", () => {
  it("recovers with GET snapshot and never resends the POST", async () => {
    const event = { eventId: "1-0", attemptId: "first", messageId: "assistant" };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(encode({ ...event, type: "accepted", turn }), { headers: { "content-type": "text/event-stream" } }))
      .mockResolvedValueOnce(new Response(encode({ ...event, eventId: "1-0", type: "snapshot", turn, text: "完成", terminal: true }), { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const receive = vi.fn();
    await expect(sendAssistantTurn("/messages", "conversation", { clientRequestId: "request" }, receive)).resolves.toEqual(turn);
    expect(fetch.mock.calls[0]?.[1].method).toBe("POST");
    expect(fetch.mock.calls[1]?.[1].method).toBeUndefined();
    expect(fetch.mock.calls[1]?.[0]).toContain("/message-streams/request/events");
    expect(receive.mock.calls.at(-1)?.[0].type).toBe("snapshot");
  });
  it("accepts JSON fallback without synthetic delta events", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(turn), { headers: { "content-type": "application/json" } })));
    const receive = vi.fn();
    await expect(sendAssistantTurn("/messages", "conversation", { clientRequestId: "request" }, receive)).resolves.toEqual(turn);
    expect(receive).not.toHaveBeenCalled();
  });
  it("aborts an in-flight stream when the account changes", async () => {
    setPrivateRequestUser("first");
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }))));
    const pending = sendAssistantTurn("/messages", "conversation", { clientRequestId: "request" });
    setPrivateRequestUser("second");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
