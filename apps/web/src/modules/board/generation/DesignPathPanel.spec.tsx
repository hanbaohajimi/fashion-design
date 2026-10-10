/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { DesignPathView } from "@fashion/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignPathPanel } from "./DesignPathPanel";

const mocks = vi.hoisted(() => ({
  fetchDesignPath: vi.fn(),
  recordDesignDecision: vi.fn(),
}));
vi.mock("./generation-api", () => mocks);
const path: DesignPathView = {
  assetId: "current",
  incomplete: false,
  decisions: [],
  steps: [
    {
      id: "step-root",
      version: 1,
      actor: "manual",
      tool: "t2i",
      intent: "原始设计",
      sources: [],
      constraints: {
        palette: [],
        notes: ["原始设计条件"],
        avoidLabels: [],
        fabricTerms: [],
      },
      parameters: {},
      createdAt: "2026-10-10T01:00:00Z",
      status: "succeeded",
      snapshotAvailable: true,
      conversationId: null,
      outputs: [
        {
          id: "root",
          url: "/root.png",
          thumbnailUrl: null,
          parentAssetId: null,
        },
      ],
    },
    {
      id: "step-current",
      version: 1,
      actor: "agent",
      tool: "i2i",
      intent: "调整袖口",
      sources: [
        {
          elementId: "root",
          assetId: "root",
          role: "edit_source",
          title: "原方案",
        },
      ],
      constraints: {
        palette: ["#112233"],
        notes: ["保留宽松袖型"],
        avoidLabels: [],
        fabricTerms: [],
      },
      parameters: { prompt: "revised cuffs" },
      createdAt: "2026-10-10T02:00:00Z",
      status: "succeeded",
      snapshotAvailable: true,
      conversationId: "conversation-a",
      outputs: [
        {
          id: "current",
          url: "/current.png",
          thumbnailUrl: null,
          parentAssetId: "root",
        },
      ],
    },
  ],
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DesignPathPanel assetId="current" />
    </QueryClientProvider>,
  );
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchDesignPath.mockResolvedValue(path);
});

describe("DesignPathPanel", () => {
  it("显示来源节点及冻结的条件，浏览或放置不自动记录设计选择", async () => {
    renderPanel();
    await screen.findByText("保留宽松袖型");
    expect(screen.getByText("#112233")).toBeTruthy();
    expect(screen.getByText("尚未作出明确选择")).toBeTruthy();
    expect(mocks.recordDesignDecision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "编辑来源：原方案" }));
    expect(
      within(screen.getByRole("region", { name: "步骤详情" })).getByText(
        "原始设计条件",
      ),
    ).toBeTruthy();
  });

  it("明确选择失败后重试沿用请求 ID，成功后刷新持久化记录", async () => {
    const saved = {
      id: "decision-a",
      assetId: "current",
      kind: "selected" as const,
      reason: "面料更自然",
      createdAt: "2026-10-10T03:00:00Z",
    };
    mocks.recordDesignDecision
      .mockRejectedValueOnce(new Error("网络中断"))
      .mockImplementationOnce(async () => {
        mocks.fetchDesignPath.mockResolvedValue({
          ...path,
          decisions: [saved],
        });
        return saved;
      });
    renderPanel();
    await screen.findByText("尚未作出明确选择");
    fireEvent.change(
      screen.getByRole("textbox", { name: "选择理由（可选）" }),
      { target: { value: " 面料更自然 " } },
    );
    fireEvent.click(screen.getByRole("button", { name: "选定此方案" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "选定此方案" }));
    await waitFor(() =>
      expect(mocks.recordDesignDecision).toHaveBeenCalledTimes(2),
    );
    expect(mocks.recordDesignDecision.mock.calls[0]).toEqual(
      mocks.recordDesignDecision.mock.calls[1],
    );
    expect(mocks.recordDesignDecision.mock.calls[1]).toEqual([
      "current",
      "selected",
      "面料更自然",
      expect.any(String),
    ]);
    await screen.findByText("最近的理由：面料更自然");
    expect(mocks.fetchDesignPath).toHaveBeenCalledTimes(2);
  });

  it("读取失败时显示重试入口，不允许记录无法核实的选择", async () => {
    mocks.fetchDesignPath.mockRejectedValueOnce(new Error("读取失败"));
    renderPanel();
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "选定此方案" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await screen.findByText("保留宽松袖型");
  });
});
