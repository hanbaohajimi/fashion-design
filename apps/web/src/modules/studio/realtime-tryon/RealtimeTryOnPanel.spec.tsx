// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RealtimeTryOnPanel } from "./RealtimeTryOnPanel";
import { RealtimeTryOnController } from "./realtime-tryon-machine";
import type { RealtimeTryOnApi, TryOnAdapter, TryOnConnection, TryOnGarment } from "./realtime-tryon-types";
import type { ComponentProps } from "react";
import type { OutfitSnapshotView, WardrobeCapabilities } from "@fashion/shared";

const requests = vi.hoisted(() => ({ capabilities: vi.fn(), garment: vi.fn() }));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ session: { user: { id: "test-user" } } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./realtime-tryon-api", () => ({ createRealtimeTryOnController: () => { throw new Error("Tests must inject a fake adapter"); } }));
vi.mock("./tryon-asset-flow", async (original) => ({
  ...await original<typeof import("./tryon-asset-flow")>(),
  fetchTryOnCapabilities: requests.capabilities,
  loadTryOnGarment: requests.garment,
}));

const capabilities = {
  enabled: true, configured: true, accessMode: "internal", provider: "decart", modelId: "lucy-vton-3.6",
  maxSessionSeconds: 60, maxGarmentBytes: 5_242_880, estimatedUsdPerSecond: "0.02", priceVerifiedAt: "2026-10-29",
};
const assets = [{ id: "garment-a", url: "/a.png", thumbnailUrl: null }];
const selected: TryOnGarment = { assetId: "garment-a", file: new File(["fixture"], "garment.png", { type: "image/png" }) };
const frames = new Map<HTMLVideoElement, VideoFrameRequestCallback>();

beforeEach(() => {
  requests.capabilities.mockResolvedValue({ ...capabilities });
  requests.garment.mockResolvedValue(selected);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, value(this: HTMLVideoElement, callback: VideoFrameRequestCallback) { frames.set(this, callback); return 1; } });
  Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", { configurable: true, value(this: HTMLVideoElement) { frames.delete(this); } });
});
afterEach(() => { cleanup(); frames.clear(); vi.restoreAllMocks(); requests.capabilities.mockReset(); requests.garment.mockReset(); });

function fakeStream() {
  const track = Object.assign(new EventTarget(), { readyState: "live", stop: vi.fn() });
  const media = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { media, track };
}
function fixture(props: Partial<ComponentProps<typeof RealtimeTryOnPanel>> = {}) {
  const local = fakeStream();
  const remote = fakeStream();
  const connection: TryOnConnection = { set: vi.fn(async () => {}), disconnect: vi.fn() };
  const api: RealtimeTryOnApi = {
    create: vi.fn(async () => ({ sessionId: "session", clientToken: "fake-short-token", tokenExpiresAt: "2026-10-29T12:00:30Z", modelId: "lucy-vton-3.6", maxSessionSeconds: 60, serverNow: "2026-10-29T12:00:00Z", estimatedUsdPerSecond: "0.02" })),
    observe: vi.fn(async () => ({})), end: vi.fn(async () => ({})),
  };
  const adapter: TryOnAdapter = { connect: vi.fn(async (options) => { options.onRemoteStream(remote.media); return connection; }) };
  const camera = vi.fn(async () => local.media);
  const controller = new RealtimeTryOnController(api, adapter, camera);
  const view = render(<RealtimeTryOnPanel projectId="project" assets={assets} canEdit controllerFactory={() => controller} {...props} />);
  return { local, remote, api, adapter, camera, controller, connection, ...view };
}
async function preview() {
  const f = fixture();
  await screen.findByText(/应用估算不代表供应商账单/);
  fireEvent.click(screen.getByRole("button", { name: "开启摄像头" }));
  await screen.findByText("仅本地预览，尚未发送到 AI");
  return f;
}

it("does not acquire a camera or create a provider session on mount", async () => {
  const f = fixture();
  await screen.findByText(/应用估算不代表供应商账单/);
  expect(f.camera).not.toHaveBeenCalled();
  expect(f.api.create).not.toHaveBeenCalled();
  expect(f.adapter.connect).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "保存这一帧" }).hasAttribute("disabled")).toBe(true);
});

it("permits only local preview while unconfigured and keeps the paid action disabled", async () => {
  requests.capabilities.mockResolvedValue({ ...capabilities, enabled: false, configured: false, unavailableReason: "管理员尚未配置实时试穿" });
  const f = await preview();
  expect(screen.getByText("管理员尚未配置实时试穿")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox"));
  const start = screen.getByRole("button", { name: "开始实时试穿" });
  expect(start.hasAttribute("disabled")).toBe(true);
  fireEvent.click(start);
  expect(f.api.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  expect(f.local.track.stop).toHaveBeenCalled();
});

it("requires consent and a newly presented remote frame before saving", async () => {
  const f = await preview();
  expect(screen.getByRole("button", { name: "开始实时试穿" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "开始实时试穿" }));
  await waitFor(() => expect(f.adapter.connect).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "保存这一帧" }).hasAttribute("disabled")).toBe(true);
  const video = screen.getByLabelText("AI 试穿结果") as HTMLVideoElement;
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 }, readyState: { value: 2 } });
  act(() => { frames.get(video)?.(0, {} as VideoFrameCallbackMetadata); });
  expect(screen.getByText("实时试穿中")).toBeTruthy();
  expect(screen.getByRole("button", { name: "保存这一帧" }).hasAttribute("disabled")).toBe(false);
  f.unmount();
  expect(f.connection.disconnect).toHaveBeenCalledTimes(1);
  expect(f.local.track.stop).toHaveBeenCalled();
  expect(f.remote.track.stop).toHaveBeenCalled();
});

it("invalidates a pending garment load when stopped, even after another local preview opens", async () => {
  let resolve!: (value: TryOnGarment) => void;
  requests.garment.mockImplementationOnce(() => new Promise<TryOnGarment>((done) => { resolve = done; }));
  const f = await preview();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "开始实时试穿" }));
  await waitFor(() => expect(requests.garment).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  fireEvent.click(screen.getByRole("button", { name: "开启摄像头" }));
  await screen.findByText("仅本地预览，尚未发送到 AI");
  await act(async () => { resolve(selected); await Promise.resolve(); });
  expect(f.api.create).not.toHaveBeenCalled();
  expect(f.adapter.connect).not.toHaveBeenCalled();
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
});

it("releases the local camera when the document becomes hidden", async () => {
  const f = await preview();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(f.local.track.stop).toHaveBeenCalled();
  expect(f.controller.getSnapshot().status).toBe("ended");
  expect(f.api.create).not.toHaveBeenCalled();
});

const outfit: OutfitSnapshotView = { id: "saved-snapshot-v12", outfitId: "outfit", projectId: "project", version: 12, layeringConfirmed: true, name: "秋日完整搭配", referenceAssetId: "garment-a", referenceUrl: "/a.png", prompt: "complete outfit", createdAt: "2026-10-30T00:00:00Z", items: ["衬衫", "大衣"].map((name, index) => ({ id: `revision-${index}`, itemId: `item-${index}`, version: 1, sourceAssetId: `source-${index}`, assetId: `item-asset-${index}`, name, category: index ? "outerwear" : "top", layer: index, wearNote: "", display: "hanger", anchor: { x: 0.5, y: 0.1 }, reviewed: true, sourceKind: "isolated", generatedCompletion: false, url: "/item.png", createdAt: "2026-10-30T00:00:00Z" })) };
const wardrobe: WardrobeCapabilities = { enabled: true, preparationEnabled: true, staticTryOnEnabled: true, realtimeOutfitEnabled: true, realtimeMultiItemVerified: true, realtimeCategories: ["top", "outerwear"] };

it("retains every selected item while unverified multi-item generation remains disabled", async () => {
  const f = fixture({ outfitSnapshot: outfit, wardrobeCapabilities: { ...wardrobe, realtimeMultiItemVerified: false }, embedded: true });
  await screen.findByText(/多件搭配的实时还原效果尚未验证/);
  expect(screen.getByText("秋日完整搭配")).toBeTruthy();
  expect(screen.getByText("衬衫、大衣")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "更换" })).toBeNull();
  expect(requests.garment).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "开启摄像头" }));
  await screen.findByText("仅本地预览，尚未发送到 AI");
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByRole("button", { name: "开始实时试穿" }).hasAttribute("disabled")).toBe(true);
  expect(f.api.create).not.toHaveBeenCalled();
});

it("starts a verified complete outfit with its saved snapshot and keeps null selection out of single-image mode", async () => {
  const f = fixture({ outfitSnapshot: outfit, wardrobeCapabilities: wardrobe });
  await waitFor(() => expect(requests.garment).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText("正在准备服装图片…")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "开启摄像头" }));
  await screen.findByText("仅本地预览，尚未发送到 AI");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "开始实时试穿" }));
  await waitFor(() => expect(f.api.create).toHaveBeenCalledWith(expect.objectContaining({ garmentAssetId: "garment-a", outfitSnapshotId: "saved-snapshot-v12" }), expect.any(String)));
  expect(vi.mocked(f.adapter.connect).mock.calls[0]?.[0].initialState.prompt).toContain("衬衫");
  expect(vi.mocked(f.adapter.connect).mock.calls[0]?.[0].initialState.prompt).toContain("大衣");
  f.rerender(<RealtimeTryOnPanel projectId="project" assets={assets} canEdit controllerFactory={() => f.controller} outfitSnapshot={null} wardrobeCapabilities={wardrobe} />);
  expect(screen.getByText(/请先保存当前搭配/)).toBeTruthy();
  expect(f.local.track.stop).toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "更换" })).toBeNull();
});

it("keeps the live camera and output while a full replacement outfit is prepared, then updates without reconnecting", async () => {
  const f = fixture({ outfitSnapshot: outfit, wardrobeCapabilities: wardrobe });
  await waitFor(() => expect(screen.queryByText("正在准备服装图片…")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "开启摄像头" }));
  await screen.findByText("仅本地预览，尚未发送到 AI");
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "开始实时试穿" }));
  await waitFor(() => expect(f.adapter.connect).toHaveBeenCalledTimes(1));
  const video = screen.getByLabelText("AI 试穿结果") as HTMLVideoElement;
  Object.defineProperties(video, { videoWidth: { value: 1280 }, videoHeight: { value: 720 }, readyState: { value: 2 } });
  act(() => { frames.get(video)?.(0, {} as VideoFrameCallbackMetadata); });
  expect(screen.getByRole("button", { name: "保存这一帧" }).hasAttribute("disabled")).toBe(false);
  f.rerender(<RealtimeTryOnPanel projectId="project" assets={assets} canEdit controllerFactory={() => f.controller} outfitSnapshot={outfit} wardrobeCapabilities={wardrobe} outfitUpdating />);
  expect(screen.getByText("正在准备当前完整搭配…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "保存这一帧" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByLabelText("AI 试穿结果")).toBe(video);
  expect(f.connection.disconnect).not.toHaveBeenCalled();
  expect(f.local.track.stop).not.toHaveBeenCalled();
  f.rerender(<RealtimeTryOnPanel projectId="project" assets={assets} canEdit controllerFactory={() => f.controller} outfitSnapshot={{ ...outfit, id: "next-complete-snapshot", version: 13 }} wardrobeCapabilities={wardrobe} />);
  await waitFor(() => expect(f.connection.set).toHaveBeenCalledTimes(1));
  expect(f.api.create).toHaveBeenCalledTimes(1);
  expect(f.adapter.connect).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "保存这一帧" }).hasAttribute("disabled")).toBe(true);
  act(() => { frames.get(video)?.(0, {} as VideoFrameCallbackMetadata); });
  expect(screen.getByRole("button", { name: "保存这一帧" }).hasAttribute("disabled")).toBe(false);
});
