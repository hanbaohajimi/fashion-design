// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForestSpiritHost } from "./ForestSpiritAssistant";
import { ForestSpiritResourceHost } from "./ForestSpiritResourceHost";
import { parseReviewSpiritCandidate } from "../../../../../scripts/manual/forest-spirit/review-spirit-resources";
import type { ReadySpiritAsset, SpiritRenderer } from "./spirit-contract";

vi.mock("./official-spirit-renderer", () => ({ createOfficialSpiritRenderer: vi.fn() }));

// Geometry and renderer here are synthetic fixtures, never approved production assets.
const asset: ReadySpiritAsset = {
  schemaVersion: 1, status: "ready", characterId: "forest-spirit-front-v8",
  visualReview: { approved: true, noEyelashes: true, crossEyeHighlights: true },
  model3Url: "/fixture/model.model3.json", coreUrl: "/fixture/core.js", runtimeModuleUrl: "/fixture/runtime.js",
  hitArea: { approved: true, viewBox: [100, 200], polygons: [[[20, 20], [80, 20], [80, 190], [20, 190]]] },
  motions: { idle: "/fixture/idle.motion3.json", hover_greet: "/fixture/hover.motion3.json", drag_hold: "/fixture/drag.motion3.json", put_down: "/fixture/down.motion3.json" },
};
const captures = new Set<number>();
const candidate = {
  ...asset, status: "diagnostic-candidate", productionApproval: false,
  visualReview: { approved: false }, hitArea: { ...asset.hitArea, approved: false },
  model3Url: "/__forest_wip/model.model3.json", coreUrl: "/__forest_wip/core.js", runtimeModuleUrl: "/__forest_wip/runtime.js",
  motions: { idle: "/__forest_wip/idle.motion3.json", hover_greet: "/__forest_wip/hover.motion3.json", drag_hold: "/__forest_wip/drag.motion3.json", put_down: "/__forest_wip/down.motion3.json" },
};
function mockRenderer(): SpiritRenderer {
  return { load: vi.fn().mockResolvedValue(undefined), play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), resume: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
}
const props = { userId: "user-1", projectId: "project-1", conversationId: "existing-conversation", chatOpen: false, onOpenChat: vi.fn() };
beforeEach(() => {
  captures.clear(); localStorage.clear(); props.onOpenChat.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => asset }));
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    readonly pointerId: number;
    readonly isPrimary: boolean;
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; this.pointerType = init.pointerType ?? "mouse"; }
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) });
  SVGElement.prototype.setPointerCapture = vi.fn(id => { captures.add(id); });
  SVGElement.prototype.hasPointerCapture = vi.fn(id => captures.has(id));
  SVGElement.prototype.releasePointerCapture = vi.fn(id => { captures.delete(id); });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => document.body) });
});
afterEach(() => { cleanup(); delete (document as Partial<Document>).elementFromPoint; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("host integration with mock renderer; not a Live2D visual acceptance", () => {
  it("rejects the same unapproved candidate that an explicit manual resource policy can load", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => candidate } as Response);
    const renderer = mockRenderer(); const factory = vi.fn(() => renderer);
    const production = render(<ForestSpiritHost {...props} rendererFactory={factory} />);
    await act(async () => undefined);
    expect(factory).not.toHaveBeenCalled();
    expect(production.container.querySelector("canvas")).toBeNull();
    production.unmount();
    const review = render(<ForestSpiritResourceHost {...props} manifestUrl="/__forest_wip/review.json" parseAsset={parseReviewSpiritCandidate} rendererFactory={factory} />);
    await screen.findByRole("button", { name: "展开设计助手" });
    expect(renderer.load).toHaveBeenCalledWith(candidate, expect.any(AbortSignal));
    expect(candidate.visualReview.approved).toBe(false);
    review.unmount();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
  it.each(["404", "invalid-json", "network-error"])("keeps the existing callback untouched on a manifest %s", async failure => {
    if (failure === "network-error") vi.mocked(fetch).mockRejectedValue(new Error("Expected network failure"));
    else vi.mocked(fetch).mockResolvedValue({ ok: failure !== "404", json: async () => { throw new SyntaxError("Expected invalid JSON"); } } as unknown as Response);
    const factory = vi.fn(mockRenderer);
    render(<ForestSpiritHost {...props} rendererFactory={factory} />);
    await act(async () => undefined);
    expect(factory).not.toHaveBeenCalled();
    expect(props.onOpenChat).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "展开设计助手" })).toBeNull();
  });
  it("aborts stale manifest reads and ignores their late completion", async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    vi.mocked(fetch).mockReturnValueOnce(pending);
    const factory = vi.fn(mockRenderer);
    const view = render(<ForestSpiritHost {...props} manifestUrl="/old.json" rendererFactory={factory} />);
    const firstSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    view.rerender(<ForestSpiritHost {...props} manifestUrl="/current.json" rendererFactory={factory} />);
    await screen.findByRole("button", { name: "展开设计助手" });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => { finish({ ok: true, json: async () => candidate } as Response); });
    expect(factory).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "展开设计助手" })).toBeDefined();
  });
  it("does not create a renderer for a missing production package", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ status: "missing" }) } as Response);
    const factory = vi.fn(() => mockRenderer());
    const view = render(<ForestSpiritHost {...props} rendererFactory={factory} />);
    await act(async () => undefined);
    expect(factory).not.toHaveBeenCalled(); expect(view.container.querySelector("canvas")).toBeNull();
  });
  it("short press opens the supplied existing-chat callback and consumes capture", async () => {
    const renderer = mockRenderer();
    render(<ForestSpiritHost {...props} rendererFactory={() => renderer} />);
    const button = await screen.findByRole("button", { name: "展开设计助手" });
    fireEvent.pointerDown(button, { pointerId: 7, button: 0, isPrimary: true, clientX: 20, clientY: 30 });
    expect(captures.has(7)).toBe(true);
    fireEvent.pointerUp(button, { pointerId: 7, button: 0, clientX: 20, clientY: 30 });
    expect(props.onOpenChat).toHaveBeenCalledOnce(); expect(captures.size).toBe(0);
    expect(renderer.pause).toHaveBeenCalled();
  });
  it("uses the same renderer when chat toggles, pauses while hidden and restores position", async () => {
    const renderer = mockRenderer(); const factory = vi.fn(() => renderer);
    localStorage.setItem("fashion:forest-spirit:user-1:project-1", JSON.stringify({ xRatio: 0.25, yRatio: 0.5 }));
    const view = render(<ForestSpiritHost {...props} rendererFactory={factory} />);
    const button = await screen.findByRole("button", { name: "展开设计助手" });
    const position = button.parentElement?.style.transform;
    expect(position).toBe("translate(172.5px, 190px)");
    view.rerender(<ForestSpiritHost {...props} chatOpen rendererFactory={factory} />);
    expect(screen.queryByRole("button", { name: "展开设计助手" })).toBeNull();
    expect(renderer.pause).toHaveBeenCalled(); expect(renderer.dispose).not.toHaveBeenCalled();
    view.rerender(<ForestSpiritHost {...props} rendererFactory={factory} />);
    expect(await screen.findByRole("button", { name: "展开设计助手" })).toBe(button);
    expect(button.parentElement?.style.transform).toBe(position); expect(factory).toHaveBeenCalledOnce();
  });
  it("window blur and pointer cancel clear accepted gestures without opening chat", async () => {
    const renderer = mockRenderer();
    render(<ForestSpiritHost {...props} rendererFactory={() => renderer} />);
    const button = await screen.findByRole("button", { name: "展开设计助手" });
    fireEvent.pointerDown(button, { pointerId: 3, button: 0, isPrimary: true });
    fireEvent.blur(window); fireEvent.pointerUp(button, { pointerId: 3 });
    expect(captures.size).toBe(0); expect(props.onOpenChat).not.toHaveBeenCalled();
    fireEvent.pointerDown(button, { pointerId: 4, button: 0, isPrimary: true });
    fireEvent.pointerCancel(button, { pointerId: 4 }); fireEvent.pointerUp(button, { pointerId: 4 });
    expect(captures.size).toBe(0); expect(props.onOpenChat).not.toHaveBeenCalled();
  });
  it.each([true, false])("checks actual DOM hit ownership when restoring (pointer inside: %s)", async (inside) => {
    const renderer = mockRenderer(); const factory = () => renderer;
    const view = render(<ForestSpiritHost {...props} rendererFactory={factory} />);
    const button = await screen.findByRole("button", { name: "展开设计助手" });
    const polygon = button.querySelector("polygon");
    if (!polygon) throw new Error("Synthetic hit polygon missing");
    view.rerender(<ForestSpiritHost {...props} chatOpen rendererFactory={factory} />);
    fireEvent.pointerMove(window, { pointerType: "mouse", clientX: 350, clientY: 240 });
    vi.mocked(document.elementFromPoint).mockReturnValue(inside ? polygon : document.body);
    view.rerender(<ForestSpiritHost {...props} rendererFactory={factory} />);
    expect(document.elementFromPoint).toHaveBeenCalledWith(350, 240);
    fireEvent.pointerEnter(polygon, { pointerType: "mouse" });
    fireEvent.pointerEnter(polygon, { pointerType: "mouse" });
    expect(vi.mocked(renderer.play).mock.calls.filter(([name]) => name === "hover_greet")).toHaveLength(inside ? 0 : 1);
    if (inside) {
      fireEvent.pointerLeave(polygon, { pointerType: "mouse" });
      fireEvent.pointerEnter(polygon, { pointerType: "mouse" });
      expect(vi.mocked(renderer.play).mock.calls.filter(([name]) => name === "hover_greet")).toHaveLength(1);
    }
    await act(async () => undefined);
  });
  it("lost pointer capture cancels the gesture and unrelated pointers cannot release it", async () => {
    const renderer = mockRenderer();
    render(<ForestSpiritHost {...props} rendererFactory={() => renderer} />);
    const button = await screen.findByRole("button", { name: "展开设计助手" });
    fireEvent.pointerDown(button, { pointerId: 3, button: 0, isPrimary: true });
    fireEvent.pointerUp(button, { pointerId: 99 });
    expect(captures.has(3)).toBe(true);
    fireEvent.lostPointerCapture(button, { pointerId: 3 });
    fireEvent.pointerUp(button, { pointerId: 3 });
    expect(props.onOpenChat).not.toHaveBeenCalled();
  });
  it("pauses the visual instance when the document is hidden and resumes without recreation", async () => {
    const renderer = mockRenderer(); const factory = vi.fn(() => renderer);
    render(<ForestSpiritHost {...props} rendererFactory={factory} />);
    await screen.findByRole("button", { name: "展开设计助手" });
    vi.mocked(renderer.pause).mockClear();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    fireEvent(document, new Event("visibilitychange"));
    expect(renderer.pause).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "展开设计助手" })).toBeNull();
    hidden.mockReturnValue(false);
    fireEvent(document, new Event("visibilitychange"));
    await screen.findByRole("button", { name: "展开设计助手" });
    expect(renderer.resume).toHaveBeenCalled(); expect(factory).toHaveBeenCalledOnce();
  });
  it("does not expose a clickable empty character after a model load failure", async () => {
    const renderer = mockRenderer(); renderer.load = vi.fn().mockRejectedValue(new Error("Expected model fixture failure"));
    render(<ForestSpiritHost {...props} rendererFactory={() => renderer} />);
    await waitFor(() => expect(renderer.load).toHaveBeenCalledOnce());
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: "展开设计助手" })).toBeNull();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(props.onOpenChat).not.toHaveBeenCalled();
  });
  it("contains synchronous renderer construction failures", async () => {
    const factory = vi.fn(() => { throw new Error("Expected renderer construction failure"); });
    render(<ForestSpiritHost {...props} rendererFactory={factory} />);
    await waitFor(() => expect(factory).toHaveBeenCalledOnce());
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: "展开设计助手" })).toBeNull();
    expect(props.onOpenChat).not.toHaveBeenCalled();
  });
  it("removes the old visual instance immediately when the manifest location changes", async () => {
    const renderer = mockRenderer(); const factory = vi.fn(() => renderer);
    const view = render(<ForestSpiritHost {...props} rendererFactory={factory} />);
    await screen.findByRole("button", { name: "展开设计助手" });
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
    view.rerender(<ForestSpiritHost {...props} manifestUrl="/replacement-manifest.json" rendererFactory={factory} />);
    expect(screen.queryByRole("button", { name: "展开设计助手" })).toBeNull();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    await act(async () => undefined);
    expect(factory).toHaveBeenCalledOnce();
  });
  it("keyboard opens existing chat and runtime errors hide only the character", async () => {
    const renderer = mockRenderer();
    const view = render(<ForestSpiritHost {...props} rendererFactory={() => renderer} />);
    const button = await screen.findByRole("button", { name: "展开设计助手" });
    fireEvent.keyDown(button, { key: "Enter" }); expect(props.onOpenChat).toHaveBeenCalledOnce();
    const canvas = view.container.querySelector("canvas");
    if (!canvas) throw new Error("mock surface missing");
    fireEvent(canvas, new CustomEvent("forest-spirit-error"));
    expect(screen.queryByRole("button", { name: "展开设计助手" })).toBeNull();
    expect(renderer.pause).toHaveBeenCalled();
  });
  it("cleans every StrictMode instance and aborts a late model load on unmount", async () => {
    const instances: SpiritRenderer[] = [];
    const signals: AbortSignal[] = [];
    let finish: (() => void) | undefined;
    const factory = () => {
      const renderer = mockRenderer();
      renderer.load = vi.fn((_asset, signal) => { signals.push(signal); return new Promise<void>(resolve => { finish = resolve; }); });
      instances.push(renderer); return renderer;
    };
    const view = render(<StrictMode><ForestSpiritHost {...props} rendererFactory={factory} /></StrictMode>);
    await waitFor(() => expect(instances.length).toBeGreaterThan(0));
    view.unmount();
    await act(async () => { finish?.(); });
    expect(signals.every(signal => signal.aborted)).toBe(true);
    for (const instance of instances) expect(instance.dispose).toHaveBeenCalledOnce();
    expect(props.onOpenChat).not.toHaveBeenCalled();
  });
});
