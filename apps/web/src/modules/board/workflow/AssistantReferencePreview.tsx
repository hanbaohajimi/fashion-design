"use client";

import { useState } from "react";
import type { WorkflowNode } from "./workflow-api";
import { displayNodeTitle, nodeImageUrl } from "./workflow-graph";
import ui from "./assistant-context.module.css";

export function referenceTypeLabel(node: WorkflowNode) {
  if (node.kind === "tool") return "设计工具";
  if (node.type === "media") return node.payload.mediaKind === "audio" ? "音频记录" : "视频记录";
  return ({ candidate: "服装方案", fabric: "面料", sketch: "草图", swatch: "色卡", reference_text: "文字素材", reference_image: "参考图片" } as Record<string, string>)[node.type] ?? "参考素材";
}

export function referenceLabel(node: WorkflowNode, nodes: readonly WorkflowNode[]) {
  const title = displayNodeTitle(node);
  const namesakes = nodes.filter(item => displayNodeTitle(item) === title).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id));
  return namesakes.length > 1 ? `${title}（${namesakes.findIndex(item => item.id === node.id) + 1}）` : title;
}

export function AssistantReferencePreview({ node }: { readonly node: WorkflowNode }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = nodeImageUrl(node);
  return url && failedUrl !== url ? (
    // Uses the same authenticated preview as the canvas; never crops the garment.
    // eslint-disable-next-line @next/next/no-img-element
    <img className={ui.referencePreview} src={url} alt="" onError={() => setFailedUrl(url)} />
  ) : (
    <span className={`${ui.referencePreview} ${ui.referencePlaceholder}`} aria-hidden="true">
      {referenceTypeLabel(node).replace("服装", "").replace("设计", "").replace("素材", "").replace("参考", "") || "素材"}
    </span>
  );
}
