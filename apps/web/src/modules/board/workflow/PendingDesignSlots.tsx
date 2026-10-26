"use client";
import { getWorkflowToolContract } from "@fashion/shared";
import type { WorkflowGraph } from "./workflow-api";
import styles from "./design-workbench.module.css";

/** 占位只来自已执行节点的真实数量与尺寸，不推测生成阶段或中间图。 */
export function PendingDesignSlots({ graph }: { graph: WorkflowGraph }) {
  return graph.nodes.filter((node) => ["generate_design", "edit_design"].includes(node.type) && ["queued", "pending", "running", "failed"].includes(node.status)).map((node) => {
    const defaults = getWorkflowToolContract(node.type === "edit_design" ? "edit_design" : "generate_design").defaults;
    const raw = node.payload.params;
    const params = { ...defaults, ...(raw && typeof raw === "object" ? raw as Record<string, unknown> : {}) };
    const count = typeof params.count === "number" && Number.isInteger(params.count) && params.count > 0 && params.count <= 16 ? params.count : 1;
    const produced = graph.nodes.filter((candidate) => candidate.type === "candidate" && graph.edges.some((edge) => edge.sourceNodeId === node.id && edge.targetNodeId === candidate.id)).length;
    const remaining = Math.max(0, count - produced);
    if (!remaining) return null;
    const width = typeof params.width === "number" && params.width > 0 ? params.width : 768;
    const height = typeof params.height === "number" && params.height > 0 ? params.height : 1024;
    return <section key={node.id} className={styles.pendingGroup} aria-label={`${node.title}待生成方案`}>
      <header><h3>{node.title}</h3><span>{node.status === "failed" ? "本次尚未完成" : "正在生成，可继续工作"}</span></header>
      <div className={styles.designGrid} data-single={count === 1}>
        {Array.from({ length: remaining }, (_, index) => <div key={index} className={styles.pendingArtwork} style={{ aspectRatio: `${width} / ${height}` }} data-failed={node.status === "failed"}>
          <span>方案 {produced + index + 1}</span><small>{node.status === "failed" ? "请查看上方原因与重试" : "图片完成后显示在这里"}</small>
        </div>)}
      </div>
    </section>;
  });
}
