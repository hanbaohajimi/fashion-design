import type { OutfitView, WardrobeCategory, WardrobeDisplay, WardrobeRevisionView } from "@fashion/shared";

export const CATEGORY_LABELS: Record<WardrobeCategory, string> = { top: "上衣", outerwear: "外套", bottom: "下装", onepiece: "连体服装", shoes: "鞋履", bag: "包袋", hat: "帽子", scarf: "围巾", belt: "腰带", accessory: "配饰" };
export const DISPLAY_LABELS: Record<WardrobeDisplay, string> = { hanger: "肩部衣架", clips: "裤裙夹", hook: "挂钩", shelf: "置物托" };
export const DEFAULT_DISPLAY: Record<WardrobeCategory, WardrobeDisplay> = { top: "hanger", outerwear: "hanger", onepiece: "hanger", bottom: "clips", shoes: "shelf", bag: "hook", hat: "shelf", scarf: "hook", belt: "hook", accessory: "shelf" };
export const SOURCE_LABELS = { isolated: "独立单品图", worn: "模特穿着图", sketch: "设计草图", outfit: "多件搭配图" } as const;
export const TASK_LABELS = { queued: "等待处理", running: "处理中", ready: "已完成", failed: "未完成", canceled: "已取消" } as const;

export interface OutfitDraft {
  outfitId: string | null;
  version: number | null;
  name: string;
  layeringConfirmed: boolean;
  items: { revisionId: string; layer: number; wearNote: string }[];
}
export const emptyOutfit = (): OutfitDraft => ({ outfitId: null, version: null, name: "我的搭配", layeringConfirmed: false, items: [] });
export function outfitDraft(outfit: OutfitView): OutfitDraft {
  return { outfitId: outfit.id, version: outfit.version, name: outfit.name, layeringConfirmed: outfit.currentSnapshot.layeringConfirmed ?? false, items: outfit.currentSnapshot.items.map(item => ({ revisionId: item.id, layer: item.layer, wearNote: item.wearNote })) };
}
export function categoriesConflict(first: WardrobeCategory, second: WardrobeCategory): boolean {
  return first === second || (first === "onepiece" && (second === "top" || second === "bottom")) || (second === "onepiece" && (first === "top" || first === "bottom"));
}
export function reorderOutfit(draft: OutfitDraft, from: number, to: number): OutfitDraft {
  if (to < 0 || to >= draft.items.length || from === to) return draft;
  const items = [...draft.items];
  const item = items.splice(from, 1)[0];
  if (!item) return draft;
  items.splice(to, 0, item);
  return { ...draft, items: items.map((entry, layer) => ({ ...entry, layer })) };
}
export function addToOutfit(draft: OutfitDraft, item: WardrobeRevisionView, replaceIds: readonly string[] = []): OutfitDraft {
  if (draft.items.some(entry => entry.revisionId === item.id)) return draft;
  const items = draft.items.filter(entry => !replaceIds.includes(entry.revisionId));
  if (items.length >= 12) throw new Error("一套搭配最多保留 12 件单品，请先移除一件。");
  return { ...draft, items: [...items, { revisionId: item.id, layer: items.length, wearNote: "" }].map((entry, layer) => ({ ...entry, layer })) };
}
/** Hit regions never move. Only this visual displacement follows the active slot. */
export function rackDisplacement(index: number, active: number | null): number {
  if (active === null || index === active) return 0;
  const distance = Math.abs(index - active);
  return Math.sign(index - active) * 48 * Math.pow(0.55, distance - 1);
}
export function outfitIsCurrent(draft: OutfitDraft, outfit?: OutfitView): boolean {
  return !!outfit && JSON.stringify(draft) === JSON.stringify(outfitDraft(outfit));
}
