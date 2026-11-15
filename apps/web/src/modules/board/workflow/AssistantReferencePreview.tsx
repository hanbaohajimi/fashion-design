"use client";

import { useState } from "react";
import type { WorkflowNode } from "./workflow-api";
import { displayNodeTitle, nodeImageUrl } from "./workflow-graph";
import ui from "./assistant-context.module.css";
import { WorkspaceIcon } from "./WorkspaceIcon";

type ReferencePreviewNode = Pick<WorkflowNode, "kind" | "type" | "payload">;
type ReferenceLabelNode = Pick<WorkflowNode, "id" | "title" | "type"> & Partial<Pick<WorkflowNode, "createdAt">>;

export function referenceTypeLabel(node: ReferencePreviewNode) {
  if (node.kind === "tool") return "设计工具";
  if (node.type === "media")
    return node.payload.mediaKind === "audio" ? "音频记录" : "视频记录";
  return (
    (
      {
        candidate: "设计图",
        fabric: "面料",
        sketch: "草图",
        swatch: "色卡",
        reference_text: "文字素材",
        reference_image: "参考图片",
      } as Record<string, string>
    )[node.type] ?? "参考素材"
  );
}

export function referenceLabel(
  node: ReferenceLabelNode,
  nodes: readonly ReferenceLabelNode[],
) {
  const title = displayNodeTitle(node);
  const namesakes = nodes
    .filter((item) => displayNodeTitle(item) === title)
    .sort(
      (a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
        a.id.localeCompare(b.id),
    );
  return namesakes.length > 1
    ? `${title}（${namesakes.findIndex((item) => item.id === node.id) + 1}）`
    : title;
}

export function AssistantReferencePreview({
  node,
  compact = false,
}: {
  readonly node: ReferencePreviewNode;
  readonly compact?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = nodeImageUrl(node);
  return url && failedUrl !== url ? (
    // Uses the same authenticated preview as the canvas; never crops the garment.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={ui.referencePreview}
      data-compact-reference={compact || undefined}
      src={url}
      alt=""
      onError={() => setFailedUrl(url)}
    />
  ) : (
    <span
      className={`${ui.referencePreview} ${ui.referencePlaceholder}`}
      data-compact-reference={compact || undefined}
      aria-hidden="true"
    >
      {compact ? (
        <WorkspaceIcon
          name={
            node.type === "reference_text"
              ? "requirements"
              : node.type === "swatch"
                ? "adjust"
                : node.kind === "tool"
                  ? "settings"
                  : "image"
          }
        />
      ) : (
        referenceTypeLabel(node)
          .replace("服装", "")
          .replace("设计", "")
          .replace("素材", "")
          .replace("参考", "") || "素材"
      )}
    </span>
  );
}
