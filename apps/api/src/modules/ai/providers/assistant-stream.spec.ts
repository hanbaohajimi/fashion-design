import { AmuxClaudeClient, rootStringFields } from "@fashion/ai";
import { SseDecoder } from "@fashion/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
const request = { instructions: "Return a reply", prompt: "hello", schemaName: "reply", jsonSchema: { type: "object" }, maxTokens: 100, parse: (input: unknown) => input as { message: string } };
function fixture(json: string, reason = "tool_use") {
  return [
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "reply", input: {} } },
    ...[...json].map((character) => ({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: character } })),
    { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: reason } }, { type: "message_stop" },
  ].map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join("");
}
describe("真实结构化流解析", () => {
  it("handles arbitrary byte boundaries, Unicode and root-only message fields before model completion", async () => {
    const json = JSON.stringify({ kind: "reply", nested: { message: "secret" }, message: '设计👩🏽‍🎨\n"亚麻"' });
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { "content-type": "text/event-stream" } })));
    const client = new AmuxClaudeClient({ apiKey: () => "test", baseUrl: "https://test", model: "test", timeoutMs: 5000 });
    const received: string[] = [];
    const pending = client.streamJson(request, async ({ text }) => { received.push(text); });
    await vi.waitFor(() => expect(controller).toBeDefined());
    if (!controller) throw new Error("missing stream controller");
    const full = fixture(json); const end = full.indexOf("event: content_block_stop");
    const prefix = new TextEncoder().encode(full.slice(0, end));
    for (const byte of prefix) controller.enqueue(new Uint8Array([byte]));
    await vi.waitFor(() => expect(received.at(-1)).toBe('设计👩🏽‍🎨\n"亚麻"'));
    expect(received.join("")).not.toContain("secret");
    controller.enqueue(new TextEncoder().encode(full.slice(end))); controller.close();
    await expect(pending).resolves.toMatchObject({ message: '设计👩🏽‍🎨\n"亚麻"' });
  });
  it.each(["refusal", "max_tokens"])("rejects %s instead of committing partial output", async (reason) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(fixture('{"message":"partial"}', reason), { headers: { "content-type": "text/event-stream" } })));
    const client = new AmuxClaudeClient({ apiKey: () => "test", baseUrl: "https://test", model: "test", timeoutMs: 5000 });
    await expect(client.streamJson(request, async () => undefined)).rejects.toThrow();
  });
  it("does not accept a truncated event stream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(fixture('{"message":"partial"}').split("event: message_stop")[0], { headers: { "content-type": "text/event-stream" } })));
    const client = new AmuxClaudeClient({ apiKey: () => "test", baseUrl: "https://test", model: "test", timeoutMs: 5000 });
    await expect(client.streamJson(request, async () => undefined)).rejects.toThrow("意外中断");
  });
  it("holds incomplete escapes and surrogate pairs", () => {
    expect(rootStringFields('{"nested":{"message":"secret"},"message":"a\\uD83D')).toEqual({ message: "a" });
    expect(rootStringFields('{"message":"a\\uD83D\\uDE00')).toEqual({ message: "a😀" });
    expect(rootStringFields('{"message":"a\\')).toEqual({ message: "a" });
  });
  it("parses SSE comments, CRLF splits and multiline fields", () => {
    const decoder = new SseDecoder();
    expect(decoder.push(": ping\r\nid: 1-0\r\nevent: assistant\r\ndata: first\r")).toEqual([]);
    expect(decoder.push("\ndata: second\r\n\r\n")).toEqual([{ id: "1-0", event: "assistant", data: "first\nsecond" }]);
  });
});
