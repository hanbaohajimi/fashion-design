import { describe, expect, it } from "vitest";
import type { WardrobeRevisionView } from "@fashion/shared";
import { addToOutfit, categoriesConflict, emptyOutfit, rackDisplacement, reorderOutfit } from "./wardrobe-state";

function item(id: string, category: WardrobeRevisionView["category"] = "top"): WardrobeRevisionView {
  return { id, itemId: `item-${id}`, version: 1, sourceAssetId: `source-${id}`, assetId: `asset-${id}`, name: id, category, display: "hanger", anchor: { x: .5, y: .08 }, reviewed: true, sourceKind: "isolated", generatedCompletion: false, url: `/${id}.png`, createdAt: "2026-10-29T00:00:00Z" };
}

describe("explicit outfit editing", () => {
  it("replaces selected garments without modifying the previous snapshot or its wear notes", () => {
    const previous = addToOutfit(addToOutfit(emptyOutfit(), item("top")), item("bottom", "bottom"));
    const bottom = previous.items[1];
    if (bottom) bottom.wearNote = "下摆收进腰部";
    const signature = JSON.stringify(previous);
    const next = addToOutfit(previous, item("new-top"), ["top"]);
    expect(next.items.map(entry => entry.revisionId)).toEqual(["bottom", "new-top"]);
    expect(next.items[0]?.wearNote).toBe("下摆收进腰部");
    expect(JSON.stringify(previous)).toBe(signature);
  });
  it("does not duplicate a selected revision and enforces the twelve-piece limit", () => {
    let draft = emptyOutfit();
    for (let index = 0; index < 12; index++) draft = addToOutfit(draft, item(String(index), "accessory"));
    expect(addToOutfit(draft, item("0"))).toBe(draft);
    expect(() => addToOutfit(draft, item("extra"))).toThrow("12");
    expect(addToOutfit(draft, item("replacement"), ["0"]).items).toHaveLength(12);
  });
  it("reorders layers immutably and ignores movement beyond either boundary", () => {
    const draft = addToOutfit(addToOutfit(emptyOutfit(), item("shirt")), item("coat", "outerwear"));
    expect(reorderOutfit(draft, 0, -1)).toBe(draft);
    const next = reorderOutfit(draft, 1, 0);
    expect(next.items.map(entry => [entry.revisionId, entry.layer])).toEqual([["coat", 0], ["shirt", 1]]);
    expect(draft.items.map(entry => entry.revisionId)).toEqual(["shirt", "coat"]);
  });
  it("treats one-piece garments as overlapping tops and bottoms but permits an outerwear slot", () => {
    expect(categoriesConflict("onepiece", "top")).toBe(true);
    expect(categoriesConflict("bottom", "onepiece")).toBe(true);
    expect(categoriesConflict("onepiece", "outerwear")).toBe(false);
  });
});
it("keeps the selected hanger fixed and gives nearby neighbours more space", () => {
  expect(rackDisplacement(3, 3)).toBe(0);
  expect(rackDisplacement(2, 3)).toBe(-rackDisplacement(4, 3));
  expect(Math.abs(rackDisplacement(2, 3))).toBeGreaterThan(Math.abs(rackDisplacement(0, 3)));
  expect(rackDisplacement(2, null)).toBe(0);
});
