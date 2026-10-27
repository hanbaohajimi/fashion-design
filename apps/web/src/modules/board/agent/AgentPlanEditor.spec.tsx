/** @vitest-environment jsdom */
import type { AgentPlanStepSpec, AgentRunView } from "@fashion/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPlanEditor } from "./AgentPlanEditor";

vi.mock("../generation/DesignPathPanel", () => ({
  DesignPathPanel: ({ assetId }: { assetId: string }) => <p>路径 {assetId}</p>,
}));
function run(): AgentRunView {
  return {
    id: "run-a",
    projectId: "project-a",
    conversationId: "conversation-a",
    intent: "风衣设计",
    status: "ready",
    revision: 3,
    createdAt: "2026-10-10T01:00:00Z",
    updatedAt: "2026-10-10T01:00:00Z",
    error: null,
    steps: ["初版", "面料"].map((title, ordinal) => ({
      id: `id-${ordinal}`,
      key: `step-${ordinal}`,
      ordinal,
      tool: "generate_design",
      title,
      instruction: "设计说明",
      prompt: "coat",
      negativePrompt: "logos",
      sourceAssetId: null,
      sourceStepKey: null,
      status: "pending",
      generationTaskId: null,
      selectedAssetId: null,
      candidates: [],
      error: null,
    })),
  };
}
afterEach(cleanup);
describe("AgentPlanEditor", () => {
  it("输出输入端口修改真实来源，拒绝前向连接，保存完整规格与初始revision", async () => {
    const original = run();
    const save = vi.fn(async (steps: readonly AgentPlanStepSpec[]) => ({
      ...original,
      revision: 4,
      steps: original.steps.map((step, index) => ({
        ...step,
        ...steps[index],
      })),
    }));
    render(
      <AgentPlanEditor
        run={original}
        busy={false}
        onSave={save}
        onDirtyChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "连接「面料」的输出" }));
    fireEvent.click(screen.getByRole("button", { name: "连接「初版」的输入" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "连接「初版」的输出" }));
    fireEvent.click(screen.getByRole("button", { name: "连接「面料」的输入" }));
    expect(
      document.querySelector(
        'path[data-source="step-0"][data-target="step-1"]',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存节点图" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            key: "step-1",
            tool: "edit_design",
            sourceStepKey: "step-0",
            sourceAssetId: null,
          }),
        ]),
        3,
      ),
    );
  });
  it("409和服务器revision改变保留本地文本，关闭时必须明确放弃修改", async () => {
    const original = run();
    const close = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error("工作流已更新，请刷新"));
    const view = render(
      <AgentPlanEditor
        run={original}
        busy={false}
        onSave={save}
        onDirtyChange={vi.fn()}
        onClose={close}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "节点标题" }), {
      target: { value: "我的廓形草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存节点图" }));
    await screen.findByRole("alert");
    view.rerender(
      <AgentPlanEditor
        run={{ ...original, revision: 4 }}
        busy={false}
        onSave={save}
        onDirtyChange={vi.fn()}
        onClose={close}
      />,
    );
    expect(
      (screen.getByRole("textbox", { name: "节点标题" }) as HTMLInputElement)
        .value,
    ).toBe("我的廓形草稿");
    expect(
      (screen.getByRole("button", { name: "保存节点图" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭节点编辑器" }));
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "放弃修改并关闭" }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("历史pending节点结构锁定，显示原prompt、拒绝原因与已有设计路径", async () => {
    const original = run();
    const first = original.steps[0];
    if (!first) throw new Error("缺少节点");
    const recorded = {
      ...original,
      steps: [
        {
          ...first,
          canEditInputs: true,
          attempts: [
            {
              id: "attempt-a",
              ordinal: 1,
              status: "rejected",
              generationTaskId: "task-a",
              prompt: "original prompt",
              negativePrompt: "logos",
              parentAssetId: null,
              candidates: [
                {
                  assetId: "asset-a",
                  url: "/candidate.png",
                  thumbnailUrl: null,
                  width: 768,
                  height: 1024,
                },
              ],
              error: "袖型不符合预期",
              createdAt: original.createdAt,
            },
          ],
        },
        ...original.steps.slice(1),
      ],
    };
    render(
      <AgentPlanEditor
        run={recorded}
        busy={false}
        onSave={vi.fn()}
        onDirtyChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "删除节点" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const history = screen.getByRole("region", { name: "节点尝试历史" });
    expect(within(history).getByText("尝试 1 已否决")).toBeTruthy();
    expect(within(history).getByText("original prompt")).toBeTruthy();
    expect(within(history).getByText("袖型不符合预期")).toBeTruthy();
    fireEvent.click(
      within(history).getByRole("button", {
        name: "查看尝试 1 的设计路径",
        hidden: true,
      }),
    );
    await screen.findByText("路径 asset-a");
  });
  it("添加新节点、排序及删除可回到原图，标题与prompt必填", async () => {
    render(
      <AgentPlanEditor
        run={run()}
        busy={false}
        onSave={vi.fn()}
        onDirtyChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "添加节点" }));
    expect(screen.getByText("请填写节点标题、设计说明与提示词")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "节点提示词" }), {
      target: { value: "new material" },
    });
    fireEvent.click(screen.getByRole("button", { name: "上移节点" }));
    expect(screen.getByRole("button", { name: "下移节点" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除节点" }));
    expect(
      (screen.getByRole("button", { name: "保存节点图" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
