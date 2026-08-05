import { afterEach, describe, expect, it, vi } from "vitest";

import { listAgentConversations, sendAgentMessage } from "./agent-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent-api", () => {
  it("loads project conversations without browser caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAgentConversations("project a")).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/project%20a/agent-conversations?limit=50",
      { cache: "no-store", credentials: "include" },
    );
  });

  it("sends only explicit shape and file context", async () => {
    const body = {
      assistantMessage: { id: "assistant-a" },
      taskId: "task-a",
      userMessage: { id: "user-a" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendAgentMessage("conversation-a", {
        clientRequestId: "request-123",
        content: "根据选中素材生成风衣",
        fileAssetIds: ["file-a"],
        shapeIds: ["shape-a"],
      }),
    ).resolves.toEqual(body);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      clientRequestId: "request-123",
      content: "根据选中素材生成风衣",
      fileAssetIds: ["file-a"],
      shapeIds: ["shape-a"],
    });
  });
});
