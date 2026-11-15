// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyCanvasCreationDraft, type CreationInputBinding } from "@fashion/shared";
import { CreationComposer } from "./CreationComposer";
import type { WorkflowGraph } from "./workflow-api";

vi.mock("../../../components/ui", () => ({ Tooltip: ({ children }: { children: ReactNode }) => children }));
vi.mock("../../../components/VoicePill", () => ({ VoicePill: () => null }));
vi.mock("../../../components/drafts/use-persistent-draft", () => ({ useDraftScope: () => null, usePersistentDraft: () => ({ ready: true, conflict: null, acknowledge: vi.fn() }) }));
afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function uploadField(container: HTMLElement) { const field = container.querySelector('input[type="file"]'); if (!field) throw new Error("缺少上传入口"); return field; }
const graph: WorkflowGraph = { projectId: "project", revision: 0, layoutRevision: 0, nodes: [], edges: [], legacyAvailable: false };
function Harness({ onUpload }: { onUpload: (files: readonly File[]) => Promise<CreationInputBinding[]> }) {
  const [value, onChange] = useState(emptyCanvasCreationDraft);
  return <CreationComposer creation={undefined} source={undefined} value={value} graph={graph} canEdit pending={false} submitting={false} pendingSave={false} onRetrySave={async () => {}} style={{}} onChange={onChange} onSave={async () => {}} onGenerate={async () => {}} onUpload={onUpload} />;
}

describe("上传参考期间的草稿", () => {
  it("上传完成只追加实际引用，保留之后输入的文字和参数", async () => {
    const upload = deferred<CreationInputBinding[]>();
    const onUpload = vi.fn(() => upload.promise);
    const view = render(<Harness onUpload={onUpload} />);
    fireEvent.change(uploadField(view.container), { target: { files: [new File(["picture"], "ref.png", { type: "image/png" })] } });
    fireEvent.change(screen.getByRole("textbox", { name: "本次创作要求" }), { target: { value: "上传时输入的新要求" } });
    fireEvent.click(screen.getByRole("button", { name: "生成参数" }));
    fireEvent.change(screen.getByLabelText("数量"), { target: { value: "3" } });
    await act(async () => upload.resolve([{ id: "uploaded", nodeId: "source-2", assetId: "asset-2" }]));
    await waitFor(() => expect(view.container.querySelector('[data-creation-reference="uploaded"]')).not.toBeNull());
    expect((screen.getByRole("textbox", { name: "本次创作要求" }) as HTMLTextAreaElement).value).toBe("上传时输入的新要求");
    expect((screen.getByLabelText("数量") as HTMLSelectElement).value).toBe("3");
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it("上传失败不清除同期编辑，离开后的迟到结果不作用于其他目标", async () => {
    const upload = deferred<CreationInputBinding[]>();
    const view = render(<Harness onUpload={() => upload.promise} />);
    fireEvent.change(uploadField(view.container), { target: { files: [new File(["picture"], "ref.png")] } });
    fireEvent.change(screen.getByRole("textbox", { name: "本次创作要求" }), { target: { value: "仍然保留" } });
    await act(async () => upload.reject(new Error("上传中断")));
    expect(screen.getByRole("alert").textContent).toBe("上传中断");
    expect((screen.getByRole("textbox", { name: "本次创作要求" }) as HTMLTextAreaElement).value).toBe("仍然保留");
    const late = deferred<CreationInputBinding[]>();
    view.unmount();
    const previous = render(<Harness onUpload={() => late.promise} />);
    fireEvent.change(uploadField(previous.container), { target: { files: [new File(["picture"], "late.png")] } });
    previous.unmount();
    const next = render(<Harness onUpload={async () => []} />);
    await act(async () => late.resolve([{ id: "late", nodeId: "old-source" }]));
    expect(next.container.querySelector("[data-creation-reference]")).toBeNull();
  });
});
