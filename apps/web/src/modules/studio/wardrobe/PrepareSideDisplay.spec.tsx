// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { WardrobeItemView, WardrobePreparationView, WardrobeRevisionView } from "@fashion/shared";
import { PrepareSideDisplay } from "./PrepareSideDisplay";

const api = vi.hoisted(() => ({ prepare: vi.fn(), presentation: vi.fn(), confirm: vi.fn(), upload: vi.fn() }));
vi.mock("./wardrobe-api", () => ({ wardrobeApi: api }));
vi.mock("./wardrobe-assets", () => ({ uploadWardrobeSource: api.upload }));
vi.mock("../../../components/ui", async original => ({ ...await original<typeof import("../../../components/ui")>(), Dialog: ({ children, label }: { children: ReactNode; label: string }) => <div role="dialog" aria-label={label}>{children}</div> }));
const imageBounds = { width: 1000, height: 1200, x: 100, y: 100, contentWidth: 800, contentHeight: 1000 };
const revision: WardrobeRevisionView = { id: "front-revision", itemId: "item", version: 2, sourceAssetId: "original", assetId: "front-asset", name: "风衣", category: "outerwear", display: "hanger", anchor: { x: .5, y: .1 }, imageBounds, reviewed: true, sourceKind: "isolated", generatedCompletion: false, url: "/front.png", createdAt: "" };
const item: WardrobeItemView = { id: "item", projectId: "project", name: "风衣", version: 2, archived: false, currentRevision: revision, revisions: [revision] };
const ready: WardrobePreparationView = { id: "side-preparation", projectId: "project", sourceAssetId: "front-asset", name: "风衣", category: "outerwear", sourceKind: "isolated", mode: "complete", presentation: { view: "side", revisionId: revision.id, orientation: "left" }, status: "ready", taskId: null, error: null, candidates: [{ assetId: "side-asset", url: "/side.png", imageBounds }], createdAt: "" };
const props = { projectId: "project", item, preparations: [], canEdit: true, generationEnabled: true, onChanged: async () => {}, onClose: vi.fn(), onSaved: vi.fn() };
beforeEach(() => { api.prepare.mockReset().mockResolvedValue(ready); api.presentation.mockReset().mockResolvedValue(item); api.confirm.mockReset(); api.upload.mockReset().mockResolvedValue({ id: "pose-asset", url: "/pose.png" }); props.onSaved.mockClear(); });
afterEach(cleanup);

it("generates a side candidate only explicitly and saves it separately from the unchanged front", async () => {
  render(<PrepareSideDisplay {...props} />);
  expect(api.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认生成侧挂候选" }));
  const confirm = await screen.findByRole("button", { name: "确认侧挂展示图" });
  expect(api.prepare).toHaveBeenCalledWith("project", expect.objectContaining({ sourceAssetId: "front-asset", mode: "complete", presentation: { view: "side", revisionId: "front-revision", orientation: "left" } }));
  expect(confirm.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(screen.getByRole("spinbutton", { name: "侧挂点横向 %" }), { target: { value: "42" } });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(confirm);
  await waitFor(() => expect(api.presentation).toHaveBeenCalledWith("project", "item", expect.objectContaining({ expectedVersion: 2, revisionId: "front-revision", sideDisplay: { preparationId: "side-preparation", assetId: "side-asset", anchor: { x: .42, y: .08 }, reviewed: true } })));
  expect(api.confirm).not.toHaveBeenCalled();
  expect(item.currentRevision.assetId).toBe("front-asset");
  expect(props.onSaved).toHaveBeenCalledTimes(1);
});

it("saves support width without starting generation or replacing a side image", async () => {
  render(<PrepareSideDisplay {...props} generationEnabled={false} />);
  expect(screen.getByRole("button", { name: "确认生成侧挂候选" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("spinbutton", { name: "挂具宽度 / 正面主体宽度 %" }), { target: { value: "48" } });
  fireEvent.click(screen.getByRole("button", { name: "仅保存挂具设置" }));
  await waitFor(() => expect(api.presentation).toHaveBeenCalled());
  expect(api.presentation.mock.calls[0]?.[2]).toMatchObject({ supportWidthRatio: .48, expectedVersion: 2 });
  expect(api.presentation.mock.calls[0]?.[2]).not.toHaveProperty("sideDisplay");
  expect(api.prepare).not.toHaveBeenCalled();
});

it("previews and explicitly saves a precise front anchor while retaining front and side assets", async () => {
  const sideDisplay = { assetId: "known-side", url: "/known-side.png", imageBounds, anchor: { x: .52, y: .065 }, orientation: "left" as const, source: "generated" as const, preparationId: "known-side-preparation", reviewed: true as const };
  const existing = { ...item, currentRevision: { ...revision, presentation: { supportWidthRatio: .62, sideDisplay } } };
  render(<PrepareSideDisplay {...props} item={existing} generationEnabled={false} />);
  const preview = screen.getByRole("img", { name: "挂架预览：风衣" });
  fireEvent.change(screen.getByRole("spinbutton", { name: "正面挂点横向 %" }), { target: { value: "47.7" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "正面挂点纵向 %" }), { target: { value: "17.6" } });
  expect(preview.querySelector<HTMLElement>("[data-garment]")?.style.getPropertyValue("--anchor-y")).toBe("17.6%");
  expect(preview.querySelector('[data-image-view="front"] img')?.getAttribute("src")).toBe("/front.png");
  expect(preview.querySelector('[data-image-view="side"] img')?.getAttribute("src")).toBe("/known-side.png");
  expect(api.presentation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "仅保存挂具设置" }));
  await waitFor(() => expect(api.presentation).toHaveBeenCalledWith("project", "item", expect.objectContaining({ revisionId: "front-revision", expectedVersion: 2, supportWidthRatio: .62 })));
  const savedAnchor = api.presentation.mock.calls[0]?.[2].frontAnchor as { x: number; y: number };
  expect(savedAnchor.x).toBeCloseTo(.477, 5); expect(savedAnchor.y).toBeCloseTo(.176, 5);
  expect(api.presentation.mock.calls[0]?.[2]).not.toHaveProperty("sideDisplay");
  expect(existing.currentRevision.anchor).toEqual({ x: .5, y: .1 });
  expect(api.prepare).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled();
});

it("calibrates one rearward shelf plane in both views without generating or changing the front anchor", async () => {
  const sideDisplay = { assetId: "known-side", url: "/known-side.png", imageBounds, anchor: { x: .5, y: .8 }, orientation: "left" as const, source: "generated" as const, preparationId: "known-side-preparation", reviewed: true as const };
  const existing = { ...item, currentRevision: { ...revision, category: "accessory" as const, display: "shelf" as const, anchor: { x: .5, y: .8 }, presentation: { supportWidthRatio: 1.04, sideDisplay } } };
  render(<PrepareSideDisplay {...props} item={existing} generationEnabled={false} />);
  const preview = screen.getByRole("img", { name: "挂架预览：风衣" });
  const surface = preview.querySelector("[data-shelf-surface]");
  const frontImage = preview.querySelector('[data-image-view="front"] img');
  expect(Number(surface?.getAttribute("data-depth"))).toBeCloseTo(24);
  fireEvent.change(screen.getByRole("spinbutton", { name: "托面纵深 / 托架宽度 %" }), { target: { value: "34.3" } });
  expect(Number(surface?.getAttribute("data-depth"))).toBeCloseTo(48.02);
  fireEvent.click(screen.getByRole("button", { name: "侧挂" }));
  expect(Number(surface?.getAttribute("data-depth"))).toBeCloseTo(48.02);
  expect(frontImage?.getAttribute("src")).toBe("/front.png");
  expect(preview.querySelector<HTMLElement>("[data-garment]")?.style.getPropertyValue("--anchor-y")).toBe("80%");
  expect(api.presentation).not.toHaveBeenCalled(); expect(api.prepare).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "仅保存挂具设置" }));
  await waitFor(() => expect(api.presentation).toHaveBeenCalledWith("project", "item", expect.objectContaining({ supportWidthRatio: 1.04, frontAnchor: { x: .5, y: .8 }, expectedVersion: 2, revisionId: "front-revision" })));
  expect(api.presentation.mock.calls[0]?.[2].shelfDepthRatio).toBeCloseTo(.343, 5);
  expect(api.presentation.mock.calls[0]?.[2]).not.toHaveProperty("sideDisplay");
  expect(api.prepare).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled();
});

it("retains the reviewed side candidate after a version conflict", async () => {
  api.presentation.mockRejectedValue(new Error("单品已有新修订，请重新核对"));
  render(<PrepareSideDisplay {...props} preparations={[ready]} />);
  fireEvent.click(screen.getByRole("button", { name: "核对侧挂候选" }));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认侧挂展示图" }));
  await screen.findByText("单品已有新修订，请重新核对");
  expect(screen.getByRole("img", { name: "待核对侧挂候选" })).toBeDefined();
  expect(props.onSaved).not.toHaveBeenCalled();
});

it("keeps one optional pose reference separate from the front and only submits it after explicit generation", async () => {
  render(<PrepareSideDisplay {...props} />);
  const file = new File(["pose-reference"], "姿态.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText(/上传侧挂姿态参考/), { target: { files: [file] } });
  await screen.findByRole("img", { name: "侧挂姿态参考" });
  expect(screen.getByRole("img", { name: "生成侧挂图的正面来源" }).getAttribute("src")).toBe("/front.png");
  expect(api.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "移除姿态参考" }));
  expect(screen.queryByRole("img", { name: "侧挂姿态参考" })).toBeNull();
  fireEvent.change(screen.getByLabelText(/上传侧挂姿态参考/), { target: { files: [file] } });
  await screen.findByRole("img", { name: "侧挂姿态参考" });
  fireEvent.click(screen.getByRole("button", { name: "确认生成侧挂候选" }));
  await waitFor(() => expect(api.prepare).toHaveBeenCalledWith("project", expect.objectContaining({ sourceAssetId: "front-asset", sourceKind: "isolated", referenceAssetIds: ["pose-asset"], presentation: { view: "side", revisionId: "front-revision", orientation: "left" } })));
  expect(api.confirm).not.toHaveBeenCalled();
});

it("uses the same three inspection backgrounds for side comparison and mount without generating or saving", () => {
  const transparent = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1200"><path d="M100 100H900V1100H100Z" fill="white" fill-opacity=".35"/></svg>')}`;
  const { container } = render(<PrepareSideDisplay {...props} preparations={[{ ...ready, candidates: [{ assetId: "side-alpha", url: transparent, imageBounds }] }]} />);
  fireEvent.click(screen.getByRole("button", { name: "核对侧挂候选" }));
  const candidate = screen.getByRole("img", { name: "待核对侧挂候选" });
  fireEvent.click(screen.getByRole("checkbox"));
  for (const label of ["深灰", "白", "场景灰"]) fireEvent.click(screen.getByRole("button", { name: label }));
  expect(container.querySelectorAll('[data-preview-background="scene"]')).toHaveLength(3);
  expect(candidate.getAttribute("src")).toBe(transparent);
  expect(candidate.style.filter).toBe("");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  expect(api.prepare).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled(); expect(api.presentation).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled();
});

it("repairs a selected side candidate only after explicit notes and preserves its original view and lineage", async () => {
  api.prepare.mockResolvedValue({ ...ready, id: "repair-preparation", status: "queued", candidates: [], taskId: "repair-task" });
  render(<PrepareSideDisplay {...props} preparations={[ready]} />);
  fireEvent.click(screen.getByRole("button", { name: "核对侧挂候选" }));
  fireEvent.click(screen.getByRole("button", { name: "朝右" }));
  fireEvent.click(screen.getByRole("button", { name: "修正此候选" }));
  const submit = screen.getByRole("button", { name: "确认修正侧挂候选" });
  expect(submit.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "候选修正说明" }), { target: { value: "  " } });
  expect(submit.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "候选修正说明" }), { target: { value: " 保留角度和框架，只修正镜片局部透明度 " } });
  expect(api.prepare).not.toHaveBeenCalled();
  fireEvent.click(submit);
  await waitFor(() => expect(api.prepare).toHaveBeenCalledWith("project", expect.objectContaining({ sourceAssetId: "side-asset", sourceKind: "isolated", mode: "extract",
    notes: "保留角度和框架，只修正镜片局部透明度", referenceAssetIds: [], presentation: { view: "side", revisionId: "front-revision", orientation: "left", repairPreparationId: "side-preparation" } })));
  expect(api.prepare.mock.calls[0]?.[1]).not.toHaveProperty("region");
  expect(screen.getByRole("button", { name: "取消侧挂准备" })).toBeDefined();
  expect(screen.getByRole("button", { name: "核对侧挂候选" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "确认侧挂展示图" })).toBeNull();
  expect(api.presentation).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled();
  expect(item.currentRevision.assetId).toBe("front-asset");
});

it("requires choosing the new repair source after switching candidates and retries a failure with the same request key", async () => {
  api.prepare.mockRejectedValue(new Error("候选修正暂不可用"));
  render(<PrepareSideDisplay {...props} preparations={[{ ...ready, candidates: [...ready.candidates, { assetId: "second-side", url: "/second-side.png", imageBounds }] }]} />);
  fireEvent.click(screen.getByRole("button", { name: "核对侧挂候选" }));
  fireEvent.click(screen.getByRole("button", { name: "修正此候选" }));
  fireEvent.change(screen.getByRole("textbox", { name: "候选修正说明" }), { target: { value: "第一候选的修正" } });
  fireEvent.click(screen.getByRole("button", { name: "侧挂候选 2" }));
  expect(screen.queryByRole("textbox", { name: "候选修正说明" })).toBeNull();
  expect(api.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "修正此候选" }));
  expect((screen.getByRole("textbox", { name: "候选修正说明" }) as HTMLTextAreaElement).value).toBe("");
  fireEvent.change(screen.getByRole("textbox", { name: "候选修正说明" }), { target: { value: "保留第二候选角度，只修正袖口纹理" } });
  fireEvent.click(screen.getByRole("button", { name: "确认修正侧挂候选" }));
  await screen.findByText("候选修正暂不可用");
  expect(screen.getByRole("img", { name: "待核对侧挂候选" }).getAttribute("src")).toBe("/second-side.png");
  fireEvent.click(screen.getByRole("button", { name: "确认修正侧挂候选" }));
  await waitFor(() => expect(api.prepare).toHaveBeenCalledTimes(2));
  expect(api.prepare.mock.calls[0]?.[1]).toMatchObject({ sourceAssetId: "second-side", requestKey: api.prepare.mock.calls[1]?.[1].requestKey });
  expect(api.presentation).not.toHaveBeenCalled();
});

it.each([{ canEdit: false, generationEnabled: true }, { canEdit: true, generationEnabled: false }])("does not allow candidate repair without edit and generation capability: %j", permissions => {
  render(<PrepareSideDisplay {...props} {...permissions} preparations={[ready]} />);
  fireEvent.click(screen.getByRole("button", { name: "核对侧挂候选" }));
  const repair = screen.getByRole("button", { name: "修正此候选" });
  expect(repair.hasAttribute("disabled")).toBe(true);
  fireEvent.click(repair);
  expect(screen.queryByRole("textbox", { name: "候选修正说明" })).toBeNull();
  expect(api.prepare).not.toHaveBeenCalled();
});
