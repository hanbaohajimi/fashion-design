// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { FabricCard } from "./FabricCard";
import { FabricDetailsEditor, createFabricDetailsDraft, parseFabricDetailsDraft } from "./FabricDetailsEditor";
import { FabricStructuredFilters } from "./FabricStructuredFilters";
import { updateFabric } from "./fabric-api";
import type { Fabric } from "./fabric-types";

vi.mock("./fabric-api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./fabric-api")>(),
  updateFabric: vi.fn(),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const fabric: Fabric = { canManage: true, id: "fabric-17", mainFileId: "file-17", mainImageUrl: "/fabric.png", scope: "user", tags: ["棉麻", "春夏"], createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", details: { name: "棉麻 A17", weightGsm: 125, provenance: { weightGsm: { source: "measured", note: "裁片称重" } } } };

describe("面料档案编辑", () => {
  it("保留已有数据来源，拒绝无来源物性及非100%成分", () => {
    const draft = createFabricDetailsDraft(fabric.details);
    expect(parseFabricDetailsDraft(draft)).toEqual({ success: true, details: fabric.details });
    expect(parseFabricDetailsDraft({ ...draft, values: { ...draft.values, composition: "棉:70,麻:20" }, sources: { ...draft.sources, composition: { source: "supplier" } } })).toMatchObject({ success: false, error: expect.stringContaining("100%") });
    expect(parseFabricDetailsDraft({ ...draft, sources: {} })).toMatchObject({ success: false, error: expect.stringContaining("资料来源") });
    expect(parseFabricDetailsDraft(createFabricDetailsDraft())).toEqual({ success: true, details: null });
  });

  it("填写规格后才能选择资料来源，AI来源仅出现在外观说明", () => {
    function Editor() { const [draft, setDraft] = useState(createFabricDetailsDraft()); return <FabricDetailsEditor value={draft} onChange={setDraft} />; }
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("克重（g/m²）"), { target: { value: "180" } });
    const weightSource = screen.getByRole("radiogroup", { name: "克重（g/m²）资料来源" });
    expect(weightSource.textContent).not.toContain("AI 外观建议");
    fireEvent.click(within(weightSource).getByRole("radio", { name: "供应商资料" }));
    expect(screen.getByLabelText("克重（g/m²）来源备注")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("外观说明"), { target: { value: "表面可见细密纹理" } });
    expect(screen.getByRole("radiogroup", { name: "外观说明资料来源" }).textContent).toContain("AI 外观建议");
  });

  it("保存失败保留用户输入，重试成功后立即展示新档案", async () => {
    const changed = vi.fn();
    vi.mocked(updateFabric).mockRejectedValueOnce(new Error("面料保存暂时失败"));
    vi.mocked(updateFabric).mockResolvedValueOnce({ ...fabric, details: { ...fabric.details, name: "棉麻 A18" } });
    render(<FabricCard fabric={fabric} onChanged={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "管理面料：棉麻 A17" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑档案" }));
    fireEvent.change(screen.getByLabelText("面料名称"), { target: { value: "棉麻 A18" } });
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("面料保存暂时失败"));
    expect((screen.getByLabelText("面料名称") as HTMLInputElement).value).toBe("棉麻 A18");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存档案" }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    expect(updateFabric).toHaveBeenLastCalledWith("fabric-17", { tags: ["棉麻", "春夏"], details: { ...fabric.details, name: "棉麻 A18" } });
    expect(screen.getByRole("heading", { name: "棉麻 A18" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "保存档案" })).toBeNull();
  });

  it("只读面料可查看来源但没有修改或删除入口", () => {
    render(<FabricCard fabric={{ ...fabric, canManage: false, scope: "preset" }} />);
    fireEvent.click(screen.getByRole("button", { name: "查看面料：棉麻 A17" }));
    expect(screen.getByText("实测 · 裁片称重")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "编辑档案" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  });
});

describe("面料规格筛选", () => {
  it("拒绝倒置范围且保留条件，提交和重置时才应用筛选", () => {
    const apply = vi.fn();
    render(<FabricStructuredFilters onApply={apply} />);
    fireEvent.change(screen.getByLabelText("成分"), { target: { value: " 棉 " } });
    fireEvent.change(screen.getByLabelText("最低克重（g/m²）"), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText("最高克重（g/m²）"), { target: { value: "150" } });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(screen.getByRole("alert").textContent).toContain("最低克重不能大于最高克重");
    expect(apply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("最高克重（g/m²）"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(apply).toHaveBeenLastCalledWith({ fiber: "棉", minWeightGsm: 200, maxWeightGsm: 250 });
    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(apply).toHaveBeenLastCalledWith({});
    expect((screen.getByLabelText("成分") as HTMLInputElement).value).toBe("");
  });
});
