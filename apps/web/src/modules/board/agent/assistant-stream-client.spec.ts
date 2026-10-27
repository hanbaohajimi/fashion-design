import { afterEach, describe, expect, it, vi } from "vitest";
import { sendAssistantTurn } from "./assistant-stream-client";
import { compareAssistantEventIds, type AssistantStreamEvent, type AssistantTurnView } from "@fashion/shared";
import { setPrivateRequestUser } from "../../auth/private-fetch";
afterEach(() => vi.unstubAllGlobals());
const message = { id: "assistant", role: "assistant", status: "completed", content: "完成", context: null, clientRequestId: null, replyToId: "user", generationTaskId: null, error: null, createdAt: "", updatedAt: "" } as const;
const turn: AssistantTurnView = { userMessage: { ...message, id: "user", role: "user" }, assistantMessage: message };
const encode = (event: AssistantStreamEvent) => `id: ${event.eventId}\nevent: assistant\ndata: ${JSON.stringify(event)}\n\n`;
describe("助手流请求", () => {
  it("orders Redis event IDs numerically", () => {
    expect(compareAssistantEventIds("1700000000000-10", "1700000000000-2")).toBe(1);
    expect(compareAssistantEventIds("10-0", "100-0")).toBe(-1);
  });
  it("recovers with GET snapshot and never resends the POST", async () => {
    const event = { eventId: "1-0", attemptId: "first", messageId: "assistant" };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(encode({ ...event, type: "accepted", turn }), { headers: { "content-type": "text/event-stream" } }))
      .mockResolvedValueOnce(new Response(encode({ ...event, eventId: "1-0", type: "snapshot", turn, text: "完成", terminal: true }), { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetch);
    const receive = vi.fn();
    await expect(sendAssistantTurn("/messages", "conversation", { clientRequestId: "request" }, receive)).resolves.toEqual(turn);
    expect(fetch.mock.calls[0]?.[1].method).toBe("POST");
    expect(fetch.mock.calls[1]?.[1].method).toBeUndefined();
    expect(fetch.mock.calls[1]?.[0]).toContain("/message-streams/request/events?after=1-0");
    expect(receive.mock.calls.at(-1)?.[0].type).toBe("snapshot");
  });
  it("deduplicates events and fences retired attempts and terminal state", async () => {
    const common = { messageId: "assistant", attemptId: "first" };
    const events: AssistantStreamEvent[] = [
      { ...common, eventId: "1-0", type: "accepted", turn },
      { ...common, eventId: "2-0", type: "message.delta", text: "旧" },
      { ...common, eventId: "2-0", type: "message.delta", text: "旧" },
      { ...common, eventId: "3-0", attemptId: "second", type: "accepted", turn },
      { ...common, eventId: "4-0", type: "message.delta", text: "迟到" },
      { ...common, eventId: "5-0", attemptId: "second", type: "message.completed", turn },
      { ...common, eventId: "6-0", attemptId: "second", type: "snapshot", text: "", terminal: false, turn },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(events.map(encode).join(""), { headers: { "content-type": "text/event-stream" } })));
    const receive = vi.fn();
    await expect(sendAssistantTurn("/messages", "conversation", { clientRequestId: "request" }, receive)).resolves.toEqual(turn);
    expect(receive.mock.calls.map(call => call[0].eventId)).toEqual(["1-0", "2-0", "3-0", "5-0"]);
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
