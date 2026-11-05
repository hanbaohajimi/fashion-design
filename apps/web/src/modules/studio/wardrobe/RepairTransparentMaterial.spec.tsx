// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useImperativeHandle, type ReactNode, type Ref } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MaskCanvasHandle, MaskCanvasState } from "../../board/generation/MaskCanvas";
import { RepairTransparentMaterial } from "./RepairTransparentMaterial";
const mocks = vi.hoisted(() => ({ start: vi.fn(), options: vi.fn(), brush: vi.fn() }));
vi.mock("./use-material-repair", () => ({ useMaterialRepair: (options: unknown) => { mocks.options(options); return { phase: "idle", taskId: null, error: null, busy: false, canRetryProcessing: false, start: mocks.start, cancel: vi.fn(), retryProcessing: vi.fn() }; } }));
vi.mock("./wardrobe-image-bounds", () => ({ useWardrobeImageBounds: () => ({ width: 1024, height: 1536, x: 100, y: 100, contentWidth: 800, contentHeight: 1300 }) }));
vi.mock("../../board/generation/MaskCanvas", () => ({ MaskCanvas: function MockMask({ ref, onChange, softness }: { ref: Ref<MaskCanvasHandle>; onChange: (state: MaskCanvasState) => void; softness: number }) {
  mocks.brush(softness);
  useImperativeHandle(ref, () => ({ exportPng: async () => new Blob(["mask"], { type: "image/png" }), clear: () => {}, undo: () => {}, addCenterRegion: () => {} }));
  return <button onClick={() => onChange({ strokeCount: 1, coverage: .1 })}>模拟涂选</button>;
} }));
vi.mock("../../../components/ui", async original => ({ ...await original<typeof import("../../../components/ui")>(), Dialog: ({ children, label }: { children: ReactNode; label: string }) => <div role="dialog" aria-label={label}>{children}</div> }));
const props = { projectId: "project", source: { assetId: "candidate", url: "/candidate.png", name: "牛仔裤", category: "bottom" as const }, canEdit: true, generationEnabled: true, onPrepared: vi.fn() };
beforeEach(() => vi.clearAllMocks()); afterEach(cleanup);

it("requires explicit internal-detail notes and selection before correction generation", async () => {
  render(<RepairTransparentMaterial {...props} operation="correction" />);
  fireEvent.click(screen.getByRole("button", { name: "局部细节修正" }));
  expect(screen.getByText(/外形或长度调整请使用其他候选修正流程/)).toBeDefined();
  expect(screen.getByText(/半透明区域、细边和轮廓附近会保持原样/)).toBeDefined();
  expect(mocks.brush).toHaveBeenLastCalledWith(.5);
  fireEvent.click(screen.getByRole("button", { name: "柔" }));
  expect(mocks.brush).toHaveBeenLastCalledWith(.8);
  expect(mocks.start).not.toHaveBeenCalled();
  expect(screen.queryByText(/只涂选后方能看到背景的透纱/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "模拟涂选" }));
  const submit = screen.getByRole("button", { name: "生成修正候选" });
  expect(submit.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "修正说明" }), { target: { value: "  " } });
  expect(submit.hasAttribute("disabled")).toBe(true); expect(mocks.start).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "修正说明" }), { target: { value: "保持轮廓与棕线，恢复细斜纹" } });
  expect(mocks.start).not.toHaveBeenCalled(); fireEvent.click(submit);
  await waitFor(() => expect(mocks.start).toHaveBeenCalledWith(expect.any(Blob), "保持轮廓与棕线，恢复细斜纹", null));
  expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({ operation: "correction", sourceAssetId: "candidate" }));
});

it("keeps transparency entry and its occlusion guidance separate", () => {
  render(<RepairTransparentMaterial {...props} />); fireEvent.click(screen.getByRole("button", { name: "修复透明材质" }));
  expect(screen.getByText(/只涂选后方能看到背景的透纱/)).toBeDefined();
  expect(screen.queryByText(/细小配件可能没有可修正范围/)).toBeNull();
  expect(screen.queryByRole("group", { name: "边缘过渡" })).toBeNull();
  expect(mocks.brush).toHaveBeenLastCalledWith(0);
  expect(screen.getByRole("textbox", { name: "修复说明（可选）" }).hasAttribute("required")).toBe(false);
  expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({ operation: "transparency" }));
  expect(mocks.start).not.toHaveBeenCalled();
});
