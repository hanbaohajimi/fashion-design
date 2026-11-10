export const imageToolEntries = [
  { action: "inpaint", label: "局部重绘" },
  { action: "remove_background", label: "移除背景" },
  { action: "erase", label: "擦除" },
  { action: "crop", label: "裁剪图片" },
  { action: "outpaint", label: "扩展画面" },
  { action: "orient", label: "旋转与翻转" },
  { action: "adjust", label: "色彩与明暗" },
  { action: "text_edit", label: "修改文字" },
  { action: "variation", label: "生成变体" },
] as const;
export type ImageToolEntry = (typeof imageToolEntries)[number]["action"];
export interface ImageToolEntryRequest { assetId: string; action: ImageToolEntry | "history"; nonce: number }

/** Entry commands select an editor only; business submission remains explicit. */
export function imageToolEntryMode(action: ImageToolEntry | "history") {
  return action === "crop" || action === "outpaint" ? "resize" : action;
}
