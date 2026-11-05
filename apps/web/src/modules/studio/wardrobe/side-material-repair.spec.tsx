// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
import type { WardrobeItemView, WardrobeMaterialProcessing, WardrobePreparationView } from "@fashion/shared";
import type { RepairTransparentMaterial } from "./RepairTransparentMaterial";
import type { GarmentMountPreview } from "./GarmentMountPreview";
import { PrepareSideDisplay } from "./PrepareSideDisplay";
type RepairProps = ComponentProps<typeof RepairTransparentMaterial>;
type MountProps = ComponentProps<typeof GarmentMountPreview>;
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), presentation: vi.fn(), confirm: vi.fn(), repair: null as RepairProps | null, mount: null as MountProps | null, result: null as WardrobePreparationView | null }));
vi.mock("./wardrobe-api", () => ({ wardrobeApi: mocks }));
vi.mock("./RepairTransparentMaterial", () => ({ RepairTransparentMaterial: (props: RepairProps) => { if (props.operation !== "correction") mocks.repair = props; return <button onClick={() => { if (mocks.result) props.onPrepared(mocks.result); }}>{props.operation === "correction" ? "返回模拟局部修正候选" : "返回模拟修复候选"}</button>; } }));
vi.mock("./GarmentMountPreview", () => ({ GarmentMountPreview: (props: MountProps) => { mocks.mount = props; return <div aria-label="挂架预览" />; } }));
vi.mock("../../../components/ui", async original => ({ ...await original<typeof import("../../../components/ui")>(), Dialog: ({ children, label }: { children: ReactNode; label: string }) => <div role="dialog" aria-label={label}>{children}</div> }));
const bounds = { width: 1024, height: 1536, x: 200, y: 100, contentWidth: 600, contentHeight: 1300 };
const item: WardrobeItemView = { id: "item", projectId: "project", name: "浅色蕾丝", version: 2, archived: false, revisions: [], currentRevision: { id: "front-revision", itemId: "item", version: 2, sourceAssetId: "source", assetId: "confirmed-front", name: "浅色蕾丝", category: "top", display: "hanger", anchor: { x: .5, y: .1 }, imageBounds: bounds, reviewed: true, sourceKind: "isolated", generatedCompletion: false, url: "/confirmed-front.png", createdAt: "" } };
const ready: WardrobePreparationView = { id: "side-preparation", projectId: "project", sourceAssetId: "confirmed-front", name: item.name, category: "top", sourceKind: "isolated", mode: "complete", presentation: { view: "side", revisionId: "front-revision", orientation: "left" }, status: "ready", taskId: null, error: null, candidates: [{ assetId: "side-candidate", url: "/side-candidate.png", imageBounds: bounds }], createdAt: "" };
const processing: WardrobeMaterialProcessing = { kind: "material-alpha", algorithm: "green-dominance-original-rgb-v1", sourceAssetId: "side-candidate", rawAssetId: "side-probe", maskAssetId: "side-mask", sourceSha256: "a".repeat(64), rawSha256: "b".repeat(64), maskSha256: "c".repeat(64), derivedSha256: "d".repeat(64) };
const derived: WardrobePreparationView = { ...ready, id: "derived-side-preparation", sourceAssetId: "derived-side", mode: "existing", materialProcessing: processing, candidates: [{ assetId: "derived-side", url: "/derived-side.png", imageBounds: bounds }] };
const props = { projectId: "project", item, preparations: [ready], canEdit: true, generationEnabled: true, onChanged: vi.fn().mockResolvedValue(undefined), onClose: vi.fn(), onSaved: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); mocks.presentation.mockResolvedValue(item); mocks.result = derived; mocks.repair = null; mocks.mount = null; });
afterEach(cleanup);

it("keeps repaired output in the bound side slot and requires a new explicit review and presentation save", async () => {
  render(<PrepareSideDisplay {...props} />); fireEvent.click(screen.getByRole("button", { name: "核对侧挂候选" }));
  expect(mocks.repair).toMatchObject({ sidePreparationId: "side-preparation", source: { assetId: "side-candidate", url: "/side-candidate.png" } });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "返回模拟修复候选" }));
  expect(screen.getByRole("img", { name: "透明修复前的侧挂候选" }).getAttribute("src")).toBe("/api/design-assets/side-candidate/content");
  expect(screen.getByRole("img", { name: "待核对侧挂候选" }).getAttribute("src")).toBe("/derived-side.png");
  expect(screen.getByRole("button", { name: "确认侧挂展示图" }).hasAttribute("disabled")).toBe(true);
  expect(mocks.mount).toMatchObject({ view: "side", item: { assetId: "confirmed-front", url: "/confirmed-front.png", presentation: { sideDisplay: { assetId: "derived-side", source: "generated", materialProcessing: processing, orientation: "left" } } } });
  expect(mocks.repair?.sidePreparationId).toBe("derived-side-preparation");
  fireEvent.click(screen.getByText("对照已确认正面")); expect(screen.getByRole("img", { name: "侧挂核对的确认正面" }).getAttribute("src")).toBe("/confirmed-front.png");
  expect(mocks.presentation).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "确认侧挂展示图" }));
  await waitFor(() => expect(mocks.presentation).toHaveBeenCalledWith("project", "item", expect.objectContaining({ revisionId: "front-revision", sideDisplay: { preparationId: "derived-side-preparation", assetId: "derived-side", anchor: { x: .5, y: .08 }, reviewed: true } })));
  expect(item.currentRevision.assetId).toBe("confirmed-front"); expect(mocks.confirm).not.toHaveBeenCalled();
});

it("retains the prior side when a returned repair has lost its front or orientation binding", () => {
  mocks.result = { ...derived, presentation: { view: "side", revisionId: "other-front", orientation: "right" } };
  render(<PrepareSideDisplay {...props} />); fireEvent.click(screen.getByRole("button", { name: "核对侧挂候选" })); fireEvent.click(screen.getByRole("button", { name: "返回模拟修复候选" }));
  expect(screen.getByText(/修复候选与当前侧挂修订或方向不匹配/)).toBeDefined();
  expect(screen.getByRole("img", { name: "待核对侧挂候选" }).getAttribute("src")).toBe("/side-candidate.png");
  expect(mocks.presentation).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});

it("retains private processing provenance on an already saved side display", () => {
  const saved = { ...item, currentRevision: { ...item.currentRevision, presentation: { sideDisplay: { assetId: "derived-side", url: "/derived-side.png", imageBounds: bounds, anchor: { x: .5, y: .08 }, orientation: "left" as const, source: "generated" as const, preparationId: derived.id, reviewed: true as const, materialProcessing: processing } } } };
  render(<PrepareSideDisplay {...props} item={saved} preparations={[]} />);
  fireEvent.click(screen.getByText("查看修复来源"));
  expect(screen.getByRole("img", { name: "修复原图" }).getAttribute("src")).toBe("/api/design-assets/side-candidate/content");
  expect(screen.getByRole("img", { name: "处理中间图（不能直接入架）" }).getAttribute("src")).toBe("/api/design-assets/side-probe/content");
  expect(mocks.presentation).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
});

it("labels a local RGB correction accurately and still leaves the front and side confirmation untouched", () => {
  mocks.result = { ...derived, materialProcessing: { ...processing, kind: "masked-edit", algorithm: "masked-provider-rgb-preserve-alpha-v1" } };
  render(<PrepareSideDisplay {...props} />); fireEvent.click(screen.getByRole("button", { name: "核对侧挂候选" }));
  fireEvent.click(screen.getByRole("button", { name: "返回模拟局部修正候选" }));
  expect(screen.getByText(/局部细节修正候选。保留原图透明度与外轮廓/)).toBeDefined();
  expect(screen.queryByText(/半透明区域、细边和轮廓附近保持原样/)).toBeNull();
  expect(screen.getByRole("img", { name: "局部修正前的侧挂候选" }).getAttribute("src")).toBe("/api/design-assets/side-candidate/content");
  expect(screen.queryByText(/透明材质修复候选/)).toBeNull();
  expect(screen.getByRole("button", { name: "确认侧挂展示图" }).hasAttribute("disabled")).toBe(true);
  expect(mocks.mount?.item.assetId).toBe("confirmed-front"); expect(mocks.presentation).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});

it("describes v2 interior protection without changing its side binding or automatic confirmation", () => {
  const interior: WardrobeMaterialProcessing = { ...processing, kind: "masked-edit", algorithm: "masked-provider-rgb-interior-v2", alphaThreshold: 240, interiorRadius: 2 };
  mocks.result = { ...derived, materialProcessing: interior };
  render(<PrepareSideDisplay {...props} />); fireEvent.click(screen.getByRole("button", { name: "核对侧挂候选" }));
  fireEvent.click(screen.getByRole("button", { name: "返回模拟局部修正候选" }));
  expect(screen.getByText(/只调整不透明面料内部，半透明区域、细边和轮廓附近保持原样/)).toBeDefined();
  expect(screen.getByRole("button", { name: "确认侧挂展示图" }).hasAttribute("disabled")).toBe(true);
  expect(mocks.mount?.item.presentation?.sideDisplay?.materialProcessing).toEqual(interior);
  expect(mocks.mount?.item.assetId).toBe("confirmed-front");
  fireEvent.click(screen.getByText("查看修正来源"));
  expect(screen.getByRole("img", { name: "修正原图" }).getAttribute("src")).toBe("/api/design-assets/side-candidate/content");
  expect(mocks.presentation).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});
