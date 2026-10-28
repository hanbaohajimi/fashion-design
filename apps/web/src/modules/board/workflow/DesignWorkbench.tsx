"use client";
import { GridDetails } from "../../../components/GridDetails";

/* §2.1/§2.4/§3.6: clothing images first, references second, process as annotations.
 * Execution owns primary emphasis; the open assistant has a quiet entry point. */
import { useEffect, useMemo, useRef } from "react";
import { ImagePreview } from "../../../components/ui";
import { TaskFeedback } from "../../../components/TaskFeedback";
import { PendingDesignSlots } from "./PendingDesignSlots";
import { motionTime, motionEase } from "../../../components/interactions/motion-policy";
import type { WorkflowGraph, WorkflowNode } from "./workflow-api";
import { buildDesignWorkbench, designNoteText } from "./design-workbench";
import { displayNodeTitle, nodeImageUrl, nodeSummary } from "./workflow-graph";
import styles from "./design-workbench.module.css";

interface Props {
  readonly graph: WorkflowGraph;
  readonly onOpen: (id: string) => void;
  readonly onReference: (id: string) => void;
  readonly onStart: () => void;
  readonly onAdd: () => void;
  readonly assistantOpen?: boolean;
  readonly pendingProposal?: boolean;
}

function AssetPreview({ node }: { readonly node: WorkflowNode }) {
  const url = nodeImageUrl(node);
  if (url) {
    return (
      <ImagePreview src={url} alt={displayNodeTitle(node)} retryable={false} />
    );
  }
  if (
    node.type === "swatch" &&
    typeof node.payload.color === "string" &&
    /^#[0-9a-f]{6}$/iu.test(node.payload.color)
  ) {
    return (
      <span
        className={styles.swatch}
        style={{ background: node.payload.color }}
        aria-label={`色卡 ${node.payload.color}`}
      />
    );
  }
  return (
    <span className={styles.textPreview}>
      {url
        ? "图片暂不可用，点击查看详情"
        : nodeSummary(node) || displayNodeTitle(node)}
    </span>
  );
}

export function DesignWorkbench({
  graph,
  onOpen,
  onReference,
  onStart,
  onAdd,
  assistantOpen = false,
  pendingProposal = false,
}: Props) {
  const work = useMemo(() => buildDesignWorkbench(graph), [graph]);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const materialsRef = useRef<HTMLElement>(null);
  const knownCandidates = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = work.groups.flatMap((group) => group.candidates.map((candidate) => candidate.id));
    const fresh = knownCandidates.current ? ids.filter((id) => !knownCandidates.current?.has(id)) : [];
    knownCandidates.current = new Set(ids);
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    if (preference.matches || document.hidden) return;
    const animations: Animation[] = [];
    const cards = Array.from(workbenchRef.current?.querySelectorAll<HTMLElement>("article[data-node-id]") ?? []);
    for (const [index, id] of fresh.slice(0, 6).entries()) {
      const card = cards.find((element) => element.dataset.nodeId === id);
      if (!card) continue;
      const bounds = card.getBoundingClientRect();
      if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) continue;
      const animation = card.animate?.([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: motionTime("--motion-image-reveal", 300), delay: index * 40, easing: motionEase() });
      if (animation) animations.push(animation);
    }
    const stop = () => animations.forEach((animation) => animation.cancel());
    preference.addEventListener("change", stop);
    return () => { stop(); preference.removeEventListener("change", stop); };
  }, [work.groups]);
  const locateMaterials = () => {
    const workbench = workbenchRef.current;
    const materials = materialsRef.current;
    if (!workbench || !materials) return;
    // Scroll only this surface; keep the project header and view switch in place.
    workbench.scrollTop +=
      materials.getBoundingClientRect().top -
      workbench.getBoundingClientRect().top -
      48;
    materials.focus({ preventScroll: true });
  };
  const total = work.groups.reduce(
    (count, group) => count + group.candidates.length,
    0,
  );
  const notes = (
    items: readonly WorkflowNode[],
    candidates: readonly WorkflowNode[] = [],
  ) =>
    items.length ? (
      <GridDetails className={styles.notes}>
        <summary>
          设计说明 <span>要求与评估 {items.length}</span>
        </summary>
        {items.map((note) => (
          <section
            key={note.id}
            data-node-id={note.id}
            role="group"
            tabIndex={-1}
            aria-label={displayNodeTitle(note)}
          >
            <h4>{note.type === "constraint" ? "设计要求" : "方案评估"}</h4>
            <ul>
              {designNoteText(note, candidates)
                .slice(0, 3)
                .map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
            </ul>
            <button type="button" onClick={() => onOpen(note.id)}>
              查看完整{note.type === "constraint" ? "要求" : "评估"}
            </button>
          </section>
        ))}
      </GridDetails>
    ) : null;

  return (
    <div
      ref={workbenchRef}
      className={styles.workbench}
      aria-label="设计作品工作台"
      role="region"
    >
      <header className={styles.heading}>
        <div>
          <h2>方案与灵感</h2>
          <p className={styles.summary}>
            {total ? `${total} 个服装方案` : "从一个想法、一张参考图开始。"}
            <span aria-hidden="true"> </span>
            <button
              type="button"
              className={styles.materialJump}
              onClick={locateMaterials}
            >
              {work.materials.length} 项参考素材
            </button>
          </p>
        </div>
        <button
          className={styles.primary}
          data-secondary={assistantOpen || pendingProposal}
          type="button"
          onClick={onStart}
        >
          {total ? "继续设计" : "开始设计"}
        </button>
      </header>

      {work.briefs.length ? (
        <section className={styles.direction} aria-label="设计方向">
          <h3>设计方向</h3>
          {work.briefs.map((brief) => (
            <div
              key={brief.id}
              data-node-id={brief.id}
              role="group"
              tabIndex={-1}
              aria-label={displayNodeTitle(brief)}
            >
              <button type="button" onClick={() => onOpen(brief.id)}>
                {nodeSummary(brief) || displayNodeTitle(brief)}
                <span>编辑</span>
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {work.activities.length ? (
        <section className={styles.activities} aria-label="设计进展">
          {work.activities.map((activity) => (
            <div
              key={activity.id}
              data-failed={activity.status === "failed"}
              data-node-id={activity.id}
              role="group"
              tabIndex={-1}
              aria-label={displayNodeTitle(activity)}
            >
              <TaskFeedback taskId={activity.id} motionKey={`node:${activity.id}`} status={activity.status} compact operation={["generate_design", "edit_design"].includes(activity.type) ? "generate" : "analysis"} />
              <strong>{displayNodeTitle(activity)}</strong>
              <button type="button" onClick={() => onOpen(activity.id)}>
                {activity.status === "failed"
                  ? "查看原因与重试"
                  : ["running", "pending"].includes(activity.status)
                    ? "查看进度"
                    : "查看步骤"}
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section aria-label="服装方案" className={styles.designs}>
        <PendingDesignSlots graph={graph} />
        {!total && !work.activities.some((activity) => ["generate_design", "edit_design"].includes(activity.type) && ["queued", "pending", "running", "failed"].includes(activity.status)) ? (
          <div className={styles.empty}>
            <h3>服装方案会展示在这里</h3>
            <p>在助手里描述款式和想保留的细节，确认方案后生成。</p>
          </div>
        ) : null}
        {work.groups.map((group, index) => (
          <section
            className={styles.group}
            key={group.id}
            aria-label={`方案组 ${index + 1}`}
          >
            <header>
              <h3>
                {group.producer ? displayNodeTitle(group.producer) : "已有方案"}
              </h3>
              <span>{group.candidates.length} 个方案</span>
            </header>
            <div className={styles.designGrid} data-single={total === 1}>
              {group.candidates.map((candidate) => (
                <article
                  key={candidate.id}
                  className={styles.card}
                  data-node-id={candidate.id}
                  role="group"
                  aria-label={`服装方案 ${displayNodeTitle(candidate)}`}
                  tabIndex={-1}
                >
                  <button
                    type="button"
                    className={styles.preview}
                    aria-label={`打开方案 ${displayNodeTitle(candidate)}`}
                    onClick={() => onOpen(candidate.id)}
                  >
                    <AssetPreview
                      key={nodeImageUrl(candidate)}
                      node={candidate}
                    />
                  </button>
                  <div className={styles.caption}>
                    <h4>{displayNodeTitle(candidate)}</h4>
                    <button
                      type="button"
                      aria-label={`以${displayNodeTitle(candidate)}继续设计`}
                      onClick={() => onReference(candidate.id)}
                    >
                      继续修改 ↗
                    </button>
                  </div>
                  {nodeSummary(candidate) ? (
                    <p className={styles.decision}>{nodeSummary(candidate)}</p>
                  ) : null}
                </article>
              ))}
            </div>
            {group.sources.length ? (
              <div className={styles.sources}>
                <span>参考了</span>
                {group.sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => onOpen(source.id)}
                  >
                    <span className={styles.sourcePreview} aria-hidden="true">
                      <AssetPreview key={nodeImageUrl(source)} node={source} />
                    </span>
                    <span>{displayNodeTitle(source)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {notes(group.notes, group.candidates)}
          </section>
        ))}
      </section>

      {notes(work.notes)}
      <section
        ref={materialsRef}
        tabIndex={-1}
        className={styles.materials}
        aria-label="参考素材"
      >
        <header>
          <div>
            <h3>参考素材</h3>
            <p>图片、面料和配色，留在手边随时引用。</p>
          </div>
          <button type="button" data-material-trigger data-guide="workspace-materials" onClick={onAdd}>
            ＋ 添加素材
          </button>
        </header>
        {work.materials.length ? (
          <div className={styles.materialGrid}>
            {work.materials.map((material) => (
              <article
                key={material.id}
                className={styles.material}
                data-node-id={material.id}
                role="group"
                aria-label={`参考素材 ${displayNodeTitle(material)}`}
                tabIndex={-1}
              >
                <button
                  className={styles.materialPreview}
                  type="button"
                  aria-label={`查看素材 ${displayNodeTitle(material)}`}
                  onClick={() => onOpen(material.id)}
                >
                  <AssetPreview key={nodeImageUrl(material)} node={material} />
                </button>
                <h4>{displayNodeTitle(material)}</h4>
                <button
                  className={styles.reference}
                  type="button"
                  onClick={() => onReference(material.id)}
                  aria-label={`引用素材 ${displayNodeTitle(material)}`}
                >
                  引用到助手 ↗
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.materialEmpty}>
            还没有参考素材。可拖入图片，也可以直接描述需求。
          </div>
        )}
      </section>
    </div>
  );
}
