"use client";
import { workflowReferenceSummarySchema } from "@fashion/shared";
import type { WorkflowMessageView } from "../agent/agent-api";
import type { WorkflowGraph } from "./workflow-api";
import styles from "./workflow-canvas.module.css";
import ui from "./assistant-context.module.css";

type Entry = { readonly nodeId: string; readonly title: string | null };
function legacyEntries(value: unknown): Entry[] | undefined {
  return Array.isArray(value) && value.every((id) => typeof id === "string")
    ? [...new Set(value as string[])].map((nodeId) => ({ nodeId, title: null })) : undefined;
}
function omitted(value: unknown) {
  return value && typeof value === "object" && "omitted" in value && typeof value.omitted === "number" ? value.omitted : 0;
}

/** Only recorded facts for this reply; graph data is used for locating and labelled fallbacks. */
export function MessageReferenceRecord({ context, graph, onLocate }: {
  readonly context: WorkflowMessageView["context"];
  readonly graph: WorkflowGraph;
  readonly onLocate: (id: string) => void;
}) {
  const parsed = workflowReferenceSummarySchema.safeParse(context?.referenceSummary);
  const summary = parsed.success ? parsed.data : null;
  const explicit = summary?.explicit ?? legacyEntries(context?.referencedNodeIds);
  const discussion = summary?.discussion ?? legacyEntries(context?.focusNodeIds);
  const images = summary?.images ?? legacyEntries(context?.visualCoverage?.attachedNodeIds);
  const coverage = context?.coverage;
  const visual = context?.visualCoverage;
  const hasRecord = explicit !== undefined || discussion !== undefined || images !== undefined || Boolean(coverage || visual);
  const group = (label: string, entries: readonly Entry[] | undefined, empty: string) => <section>
    <h4>{label}</h4>
    {entries === undefined ? <p>未记录</p> : entries.length === 0 ? <p>{empty}</p> : <ul>{entries.map((entry) => {
      const node = graph.nodes.find((item) => item.id === entry.nodeId);
      const name = entry.title ?? (node ? `${node.title}（当前名称）` : "名称未记录");
      return <li key={entry.nodeId}><button className={styles.nodeLink} disabled={!node} onClick={() => onLocate(entry.nodeId)} type="button">{name}</button>{!node ? <small>节点已移除，无法定位</small> : null}</li>;
    })}</ul>}
  </section>;
  if (!hasRecord) return <p className={ui.referenceRecord}>这条回复未保存引用记录</p>;
  return <details className={ui.referenceRecord}>
    <summary>查看引用记录</summary>
    <>
      <p>记录本轮引用的对象与传入图片，不代表全部回答依据。</p>
      {group("本轮显式引用", explicit, "本轮没有显式引用")}
      {group("讨论对象", discussion, "整个项目")}
      {group("传入图片", images, "本轮没有传入图片")}
      {visual || coverage ? <details>
        <summary>图片统计与读取范围</summary>
        {visual ? <p>本轮记录：{typeof visual.total === "number" ? `共 ${visual.total} 张；` : ""}{typeof visual.ready === "number" ? `已有分析记录 ${visual.ready} 张；` : ""}{typeof visual.pending === "number" ? `处理中 ${visual.pending} 张；` : ""}{typeof visual.failed === "number" ? `读取失败 ${visual.failed} 张。` : ""}</p> : null}
        {images ? <p>传入模型 {images.length} 张图片。传入成功不表示助手已准确理解。</p> : <p>未记录传入模型的图片数量。</p>}
        {typeof coverage?.note === "string" ? <p>{coverage.note}</p> : null}
        {omitted(coverage?.attempts) > 0 ? <p>另有 {omitted(coverage?.attempts)} 条执行历史未载入本轮详情。</p> : null}
        {omitted(coverage?.memory) > 0 ? <p>另有 {omitted(coverage?.memory)} 条项目记忆未载入本轮详情。</p> : null}
      </details> : null}
    </>
  </details>;
}
