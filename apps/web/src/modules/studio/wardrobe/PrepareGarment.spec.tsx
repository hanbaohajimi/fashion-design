// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WardrobeItemView, WardrobePreparationView } from "@fashion/shared";
import type { ReactNode } from "react";
import { PrepareGarment } from "./PrepareGarment";

const api = vi.hoisted(() => ({ prepare: vi.fn(), confirm: vi.fn(), upload: vi.fn() }));
vi.mock("./wardrobe-api", () => ({ wardrobeApi: api }));
vi.mock("./wardrobe-assets", () => ({ uploadWardrobeSource: api.upload }));
vi.mock("../studio-ui", () => ({ AssetPicker: ({ label }: { label: string }) => <div>{label}</div> }));
vi.mock("../../../components/ui", async original => ({ ...await original<typeof import("../../../components/ui")>(), Dialog: ({ children, label }: { children: ReactNode; label: string }) => <div role="dialog" aria-label={label}>{children}</div> }));
const ready: WardrobePreparationView = { id: "preparation", projectId: "project", sourceAssetId: "source", name: "白衬衫", category: "top", sourceKind: "isolated", mode: "existing", status: "ready", taskId: null, error: null, candidates: [{ assetId: "candidate", url: "/candidate.png" }], createdAt: "" };
beforeEach(() => { api.prepare.mockReset().mockResolvedValue(ready); api.confirm.mockReset().mockResolvedValue({}); api.upload.mockReset().mockResolvedValue({ id: "new-source", url: "/new-source.png", thumbnailUrl: null }); });
afterEach(cleanup);

it("compares a processed candidate with its original image rather than itself and keeps provenance private", () => {
  const materialProcessing = { kind: "material-alpha" as const, algorithm: "green-dominance-original-rgb-v1" as const, sourceAssetId: "original-lace", rawAssetId: "model-intermediate", maskAssetId: "selected-region", sourceSha256: "a", rawSha256: "b", maskSha256: "c", derivedSha256: "d" };
  render(<PrepareGarment projectId="project" assets={[{ id: "derived", url: "/derived.png", thumbnailUrl: null }]} preparations={[{ ...ready, sourceAssetId: "derived", materialProcessing, candidates: [{ assetId: "derived", url: "/derived.png" }] }]} canEdit generationEnabled onChanged={async () => {}} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "查看与继续" }));
  expect(screen.getByRole("img", { name: "原始服装图片" }).getAttribute("src")).toBe("/api/design-assets/original-lace/content");
  expect(screen.getByRole("img", { name: "待确认单品候选" }).getAttribute("src")).toBe("/derived.png");
  fireEvent.click(screen.getByText("查看修复来源"));
  expect(screen.getByRole("img", { name: "处理中间图（不能直接入架）" }).getAttribute("src")).toBe("/api/design-assets/model-intermediate/content");
  expect(screen.getByRole("img", { name: "所选区域" }).getAttribute("src")).toBe("/api/design-assets/selected-region/content");
  expect(api.prepare).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled();
});

it("requires explicit preparation and human confirmation, invalidating review when the anchor changes", async () => {
  render(<PrepareGarment projectId="project" assets={[{ id: "source", url: "/source.png", thumbnailUrl: null }]} preparations={[]} canEdit generationEnabled initialAssetId="source" onChanged={async () => {}} onClose={vi.fn()} />);
  expect(api.prepare).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "单品名称" }), { target: { value: "白衬衫" } });
  fireEvent.click(screen.getByRole("button", { name: "继续核对单品" }));
  const confirm = await screen.findByRole("button", { name: "确认单品并挂上衣架" });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(confirm.hasAttribute("disabled")).toBe(false);
  fireEvent.change(screen.getByRole("spinbutton", { name: "挂点横向 %" }), { target: { value: "40" } });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(confirm);
  await waitFor(() => expect(api.confirm).toHaveBeenCalledWith("project", expect.objectContaining({ reviewed: true, anchor: { x: .4, y: .08 }, assetId: "candidate" })));
});

it("creates a new item revision with the original version guard instead of duplicating the item", async () => {
  const revision = { id: "revision-2", itemId: "item", version: 2, sourceAssetId: "source", assetId: "candidate", name: "白衬衫", category: "top" as const, display: "hanger" as const, anchor: { x: .5, y: .1 }, reviewed: true, sourceKind: "isolated" as const, generatedCompletion: false, url: "/candidate.png", createdAt: "" };
  const existing: WardrobeItemView = { id: "item", projectId: "project", name: "白衬衫", version: 2, archived: false, currentRevision: revision, revisions: [revision] };
  render(<PrepareGarment projectId="project" assets={[]} preparations={[]} canEdit generationEnabled existingItem={existing} onChanged={async () => {}} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "继续核对单品" }));
  const confirm = await screen.findByRole("button", { name: "确认单品并挂上衣架" });
  fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(confirm);
  await waitFor(() => expect(api.confirm).toHaveBeenCalledWith("project", expect.objectContaining({ itemId: "item", expectedVersion: 2 })));
});

it("uploads a new source into the project without preparing or publishing a garment automatically", async () => {
  render(<PrepareGarment projectId="project" assets={[]} preparations={[]} canEdit generationEnabled onChanged={async () => {}} onClose={vi.fn()} />);
  const file = new File(["private-image"], "蓝色外套.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText(/上传来源图片/), { target: { files: [file] } });
  await waitFor(() => expect(api.upload).toHaveBeenCalledWith("project", file, expect.any(AbortSignal)));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "单品名称" }) as HTMLInputElement).value).toBe("蓝色外套"));
  expect(api.prepare).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "继续核对单品" }));
  await waitFor(() => expect(api.prepare).toHaveBeenCalledWith("project", expect.objectContaining({ sourceAssetId: "new-source" })));
  expect(api.confirm).not.toHaveBeenCalled();
});

it("previews the current candidate and mount edits without preparing or confirming a revision", () => {
  render(<PrepareGarment projectId="project" assets={[{ id: "source", url: "/source.png", thumbnailUrl: null }]} preparations={[{ ...ready, candidates: [...ready.candidates, { assetId: "candidate-2", url: "/candidate-2.png" }] }]} canEdit generationEnabled onChanged={async () => {}} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "查看与继续" }));
  const preview = screen.getByRole("img", { name: "挂架预览：白衬衫" });
  expect(preview.querySelector("img")?.getAttribute("src")).toBe("/candidate.png");
  expect(screen.getByText(/有帽时选帽子下的领口/)).toBeDefined();
  fireEvent.change(screen.getByRole("spinbutton", { name: "挂点横向 %" }), { target: { value: "37.7" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "挂点纵向 %" }), { target: { value: "92.5" } });
  fireEvent.click(screen.getByRole("radio", { name: "置物托" }));
  const garment = preview.querySelector<HTMLElement>("[data-garment]");
  expect(garment?.style.getPropertyValue("--anchor-x")).toBe("37.7%");
  expect(garment?.style.getPropertyValue("--anchor-y")).toBe("92.5%");
  expect((screen.getByRole("spinbutton", { name: "挂点纵向 %" }) as HTMLInputElement).value).toBe("92.5");
  expect(garment?.dataset.display).toBe("shelf");
  expect(screen.getByText(/鞋底或配饰底部的实际落点/)).toBeDefined();
  fireEvent.click(screen.getByRole("radio", { name: "候选 2" }));
  expect(preview.querySelector("img")?.getAttribute("src")).toBe("/candidate-2.png");
  expect(screen.getByRole("button", { name: "确认单品并挂上衣架" }).hasAttribute("disabled")).toBe(true);
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.confirm).not.toHaveBeenCalled();
});

it("describes sketch completion as a reviewed realistic candidate without selecting or starting generation", () => {
  render(<PrepareGarment projectId="project" assets={[{ id: "source", url: "/source.png", thumbnailUrl: null }]} preparations={[]} canEdit generationEnabled initialAssetId="source" onChanged={async () => {}} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("radio", { name: "设计草图" }));
  expect(screen.getByRole("radio", { name: "使用已有独立单品图" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("radio", { name: "生成写实单品候选" })).toBeDefined();
  expect(screen.getByRole("radio", { name: "从图片中提取单品" })).toBeDefined();
  fireEvent.click(screen.getByRole("radio", { name: "生成写实单品候选" }));
  expect(screen.getByText(/面料材质和草图未说明的结构需要人工核对/)).toBeDefined();
  expect(api.prepare).not.toHaveBeenCalled();
  expect(api.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: "模特穿着图" }));
  expect(screen.getByRole("radio", { name: "提取并补全遮挡部分" }).getAttribute("aria-checked")).toBe("true");
});

it("switches all inspection backgrounds without changing partial-alpha imagery or submitting work", () => {
  const transparent = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="120"><path d="M10 10H90V110H10Z" fill="white" fill-opacity=".35"/></svg>')}`;
  const { container } = render(<PrepareGarment projectId="project" assets={[{ id: "source", url: transparent, thumbnailUrl: null }]} preparations={[{ ...ready, candidates: [{ assetId: "alpha-candidate", url: transparent, imageBounds: { width: 100, height: 120, x: 10, y: 10, contentWidth: 80, contentHeight: 100 } }] }]} canEdit generationEnabled onChanged={async () => {}} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "查看与继续" }));
  const candidate = screen.getByRole("img", { name: "待确认单品候选" });
  const confirm = screen.getByRole("button", { name: "确认单品并挂上衣架" });
  for (const [label, background, color] of [["白", "white", "rgb(255, 255, 255)"], ["深灰", "dark", "rgb(48, 48, 48)"], ["场景灰", "scene", "rgb(228, 227, 229)"]] as const) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    const surfaces = container.querySelectorAll<HTMLElement>("[data-preview-background]");
    expect(surfaces).toHaveLength(3);
    surfaces.forEach(surface => { expect(surface.dataset.previewBackground).toBe(background); expect(surface.style.backgroundColor).toBe(color); });
    expect(candidate.getAttribute("src")).toBe(transparent);
    expect(candidate.style.filter).toBe("");
    expect(confirm.hasAttribute("disabled")).toBe(true);
  }
  expect(api.prepare).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled(); expect(api.upload).not.toHaveBeenCalled();
});
