import { expect, it } from "vitest";
import type { OutfitSnapshotItem, OutfitSnapshotView, WardrobeCapabilities } from "@fashion/shared";
import { compileOutfitTryOnPrompt, outfitTryOnUnavailableReason } from "./outfit-tryon-reference";

const item = (category: OutfitSnapshotItem["category"], name: string, layer: number): OutfitSnapshotItem => ({ id: name, itemId: name, version: 1, sourceAssetId: name, assetId: name, name, category, layer, wearNote: "", display: "hanger", anchor: { x: 0.5, y: 0.1 }, reviewed: true, sourceKind: "isolated", generatedCompletion: false, url: "/asset", createdAt: "2026-10-30T00:00:00Z" });
const snapshot: OutfitSnapshotView = { id: "snapshot-version-7", outfitId: "outfit", projectId: "project", version: 7, layeringConfirmed: true, name: "完整搭配", items: [item("outerwear", "大衣", 2), item("top", "衬衫", 0), item("hat", "帽子", 1)], referenceAssetId: "reference", prompt: "", createdAt: "2026-10-30T00:00:00Z" };
const capabilities: WardrobeCapabilities = { enabled: true, preparationEnabled: true, staticTryOnEnabled: true, realtimeOutfitEnabled: true, realtimeMultiItemVerified: true, realtimeCategories: ["outerwear", "top", "hat"] };

it("keeps the whole selection and refuses unverified multi-item or unsupported categories", () => {
  expect(outfitTryOnUnavailableReason(snapshot, { ...capabilities, realtimeMultiItemVerified: false })).toContain("多件搭配");
  expect(outfitTryOnUnavailableReason(snapshot, { ...capabilities, realtimeCategories: ["top"] })).toContain("尚未验证");
  expect(snapshot.items).toHaveLength(3);
  expect(outfitTryOnUnavailableReason(snapshot, capabilities)).toBeNull();
  expect(outfitTryOnUnavailableReason(snapshot)).toContain("尚未启用");
});

it("requires a saved snapshot and a prepared reference before trying an outfit", () => {
  expect(outfitTryOnUnavailableReason(null, capabilities)).toContain("先保存");
  const { referenceAssetId: _reference, ...unprepared } = snapshot;
  expect(_reference).toBe("reference");
  expect(outfitTryOnUnavailableReason(unprepared, capabilities)).toContain("准备参考图");
});

it("compiles the entire outfit in layer order, explicitly replacing removed items", () => {
  const prompt = compileOutfitTryOnPrompt(snapshot);
  expect(prompt).toContain("entire desired outfit");
  expect(prompt).toContain("items removed");
  expect(prompt.indexOf("衬衫")).toBeLessThan(prompt.indexOf("帽子"));
  expect(prompt.indexOf("帽子")).toBeLessThan(prompt.indexOf("大衣"));
  expect(prompt).not.toContain("Substitute the current top");
});
