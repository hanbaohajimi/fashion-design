"use client";

import type { WardrobeMaterialProcessing } from "@fashion/shared";
import { ImagePreview } from "../../../components/ui";
import styles from "./wardrobe.module.css";

export function MaterialProcessingDetails({ processing }: { processing: WardrobeMaterialProcessing }) {
  const correction = processing.kind === "masked-edit";
  const description = correction
    ? processing.algorithm === "masked-provider-rgb-interior-v2"
      ? "局部细节修正候选。只调整不透明面料内部，半透明区域、细边和轮廓附近保持原样；请对照原图核对颜色接缝、纹理与缝线。"
      : "局部细节修正候选。保留原图透明度与外轮廓，选区外内容保持原样；请对照原图核对选区内的纹理与缝线。"
    : "透明材质修复候选。保留原图颜色，只处理所选薄纱区域；请在三种底色下核对实体、纹理与透射。";
  return <div className={styles.stack}>
    <p>{description}</p>
    <details><summary>{correction ? "查看修正来源" : "查看修复来源"}</summary><div className={styles.comparison}>
      {[[correction ? "修正原图" : "修复原图", processing.sourceAssetId], ["处理中间图（不能直接入架）", processing.rawAssetId], ["所选区域", processing.maskAssetId]].map(([label, assetId]) => <figure key={assetId}><figcaption>{label}</figcaption><div className={styles.compareImage}><ImagePreview src={`/api/design-assets/${encodeURIComponent(assetId ?? "")}/content`} alt={label ?? "处理来源"} retryable={false} /></div></figure>)}
    </div></details>
  </div>;
}
