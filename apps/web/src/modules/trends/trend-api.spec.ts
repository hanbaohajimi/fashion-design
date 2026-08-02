import { afterEach, describe, expect, it, vi } from "vitest";

import { importTrendToBoard, TrendApiError } from "./trend-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("importTrendToBoard", () => {
  it("向白板导入接口发送趋势标识", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          elements: [
            {
              id: "element-1",
              record: {},
              role: "note",
              shapeId: "shape:trend-1-note",
              shapeType: "fashion-note",
            },
          ],
          success: true,
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(importTrendToBoard("board/1", "trend-1")).resolves.toMatchObject({
      success: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/boards/board%2F1/import-trend",
      expect.objectContaining({
        body: JSON.stringify({ trendItemId: "trend-1" }),
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("保留重复导入的状态码和业务错误码", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "TREND_ALREADY_IMPORTED",
            message: "该趋势已存在于白板",
          }),
          { headers: { "Content-Type": "application/json" }, status: 409 },
        ),
      ),
    );

    const request = importTrendToBoard("board-1", "trend-1");
    await expect(request).rejects.toBeInstanceOf(TrendApiError);
    await expect(request).rejects.toMatchObject({
      code: "TREND_ALREADY_IMPORTED",
      message: "该趋势已存在于白板",
      status: 409,
    });
  });
});
