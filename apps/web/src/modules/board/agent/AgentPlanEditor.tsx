"use client";

import {
  AGENT_PLAN_MAX_STEPS,
  type AgentPlanStepSpec,
  type AgentRunView,
} from "@fashion/shared";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DesignPathPanel } from "../generation/DesignPathPanel";
import {
  attemptStatusLabel,
  connectPlanSteps,
  editablePlanKeys,
  movePlanStep,
  planGraphLayout,
  planSpecs,
  removePlanStep,
  validatePlanDraft,
} from "./agent-plan-graph";
import styles from "./agent-plan-editor.module.css";

export function AgentPlanEditor({
  run,
  busy,
  onSave,
  onDirtyChange,
  onClose,
}: {
  readonly run: AgentRunView;
  readonly busy: boolean;
  readonly onSave: (
    steps: readonly AgentPlanStepSpec[],
    revision: number,
  ) => Promise<AgentRunView>;
  readonly onDirtyChange: (dirty: boolean) => void;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => planSpecs(run));
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(planSpecs(run)),
  );
  const [revision, setRevision] = useState(run.revision);
  const [selectedKey, setSelectedKey] = useState(run.steps[0]?.key ?? "");
  const [connectionFrom, setConnectionFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pathAssetId, setPathAssetId] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const canEdit = ["ready", "paused", "failed"].includes(run.status);
  const knownKeys = new Set(run.steps.map((step) => step.key));
  const editableKeys = new Set([
    ...editablePlanKeys(run),
    ...draft.filter((step) => !knownKeys.has(step.key)).map((step) => step.key),
  ]);
  const selected = draft.find((step) => step.key === selectedKey) ?? draft[0];
  const selectedIndex = draft.findIndex((step) => step.key === selected?.key);
  const editable = canEdit && selected && editableKeys.has(selected.key);
  const validation = validatePlanDraft(draft);
  const stale = revision !== run.revision;
  const layout = planGraphLayout(draft);
  const historical = run.steps.find((step) => step.key === selected?.key);
  const hasHistory = Boolean(
    historical &&
    (historical.status !== "pending" ||
      historical.attempts?.length ||
      historical.generationTaskId ||
      historical.selectedAssetId),
  );

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (busy) return;
        if (pathAssetId) setPathAssetId(null);
        else if (dirty) setConfirmClose(true);
        else onClose();
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const controls = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex='0']",
        ),
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [busy, dirty, onClose, pathAssetId]);

  const updateSelected = (change: Partial<AgentPlanStepSpec>): void => {
    if (!selected || !editable || busy) return;
    setDraft((current) =>
      current.map((step) =>
        step.key === selected.key ? { ...step, ...change } : step,
      ),
    );
    setError(null);
  };
  const attemptChange = (operation: () => AgentPlanStepSpec[]): void => {
    try {
      setDraft(operation());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "节点修改失败");
    }
  };
  const reset = (): void => {
    const fresh = planSpecs(run);
    setDraft(fresh);
    setBaseline(JSON.stringify(fresh));
    setRevision(run.revision);
    setSelectedKey(fresh[0]?.key ?? "");
    setConnectionFrom(null);
    setError(null);
  };
  const save = async (): Promise<void> => {
    if (validation || busy || stale || !dirty) return;
    try {
      const updated = await onSave(draft, revision);
      const fresh = planSpecs(updated);
      setDraft(fresh);
      setBaseline(JSON.stringify(fresh));
      setRevision(updated.revision);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，修改已保留");
    }
  };
  const connect = (targetKey: string): void => {
    setSelectedKey(targetKey);
    if (!connectionFrom) {
      setError("请先选择前序节点的输出端口，或在属性栏选择输入来源");
      return;
    }
    attemptChange(() => connectPlanSteps(draft, connectionFrom, targetKey));
    setConnectionFrom(null);
  };
  const sourceAssets = run.sourceAssets ?? [];
  const sourceValue = selected?.sourceStepKey
    ? `step:${selected.sourceStepKey}`
    : selected?.sourceAssetId
      ? `asset:${selected.sourceAssetId}`
      : "";

  return createPortal(
    <div className={styles.scrim}>
      <div
        className={styles.editor}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-plan-editor-title"
        ref={dialog}
      >
        <header className={styles.header}>
          <div>
            <span>DESIGN NODES</span>
            <h2 id="agent-plan-editor-title">编辑设计节点图</h2>
            <p>{run.intent}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => (dirty ? setConfirmClose(true) : onClose())}
            aria-label="关闭节点编辑器"
          >
            关闭
          </button>
        </header>
        <div className={styles.toolbar}>
          <p>
            {connectionFrom
              ? `已选「${draft.find((step) => step.key === connectionFrom)?.title}」输出，点击后续节点的输入连接。`
              : "选择节点查看参数与执行记录。未执行节点可调整顺序和输入来源。"}
          </p>
          <button
            type="button"
            disabled={busy || !canEdit || draft.length >= AGENT_PLAN_MAX_STEPS}
            onClick={() => {
              const baseKey = `step_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
              let key = baseKey;
              let suffix = 1;
              while (draft.some((step) => step.key === key))
                key = `${baseKey}_${suffix++}`;
              setDraft((current) => [
                ...current,
                {
                  key,
                  tool: "generate_design",
                  title: "新的设计节点",
                  instruction: "说明这个节点要完成的设计调整",
                  prompt: "",
                  negativePrompt: "",
                  sourceAssetId: null,
                  sourceStepKey: null,
                },
              ]);
              setSelectedKey(key);
              setPathAssetId(null);
            }}
          >
            添加节点
          </button>
        </div>
        {stale ? (
          <div className={styles.notice} role="alert">
            服务器计划已更新，当前修改已保留。
            <button type="button" disabled={busy} onClick={reset}>
              重新加载并放弃修改
            </button>
          </div>
        ) : null}
        <div className={styles.content}>
          <div className={styles.canvas} aria-label="节点依赖图">
            <div
              className={styles.graphSurface}
              style={{ width: layout.width, height: layout.height }}
            >
              <svg
                className={styles.edges}
                width={layout.width}
                height={layout.height}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="agent-graph-arrow"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0 0 6 3 0 6Z" />
                  </marker>
                </defs>
                {draft
                  .filter((step) => step.sourceStepKey)
                  .map((step) => {
                    const source = layout.nodes.find(
                      (node) => node.key === step.sourceStepKey,
                    );
                    const target = layout.nodes.find(
                      (node) => node.key === step.key,
                    );
                    if (!source || !target) return null;
                    const x1 = source.x + 224;
                    const y1 = source.y + 76;
                    const x2 = target.x;
                    const y2 = target.y + 76;
                    return (
                      <path
                        key={step.key}
                        data-source={step.sourceStepKey}
                        data-target={step.key}
                        d={`M${x1} ${y1} C${x1 + 34} ${y1},${x2 - 34} ${y2},${x2} ${y2}`}
                        markerEnd="url(#agent-graph-arrow)"
                      />
                    );
                  })}
              </svg>
              {draft.map((step, index) => {
                const position = layout.nodes.find(
                  (node) => node.key === step.key,
                );
                const saved = run.steps.find((item) => item.key === step.key);
                const locked = !canEdit || !editableKeys.has(step.key);
                const historicalNode = Boolean(
                  saved &&
                  (saved.status !== "pending" ||
                    saved.attempts?.length ||
                    saved.generationTaskId ||
                    saved.selectedAssetId),
                );
                return (
                  <div
                    className={styles.graphNode}
                    key={step.key}
                    data-selected={selected?.key === step.key}
                    data-locked={locked}
                    style={{ left: position?.x ?? 0, top: position?.y ?? 0 }}
                  >
                    <button
                      className={styles.inputPort}
                      type="button"
                      disabled={busy || locked}
                      onClick={() => connect(step.key)}
                      aria-label={`连接「${step.title}」的输入`}
                      title="连接输入"
                    />
                    <button
                      className={styles.nodeBody}
                      type="button"
                      aria-pressed={selected?.key === step.key}
                      onClick={() => {
                        setSelectedKey(step.key);
                        setPathAssetId(null);
                      }}
                    >
                      <span>
                        <b>{String(index + 1).padStart(2, "0")}</b>
                        <small>
                          {historicalNode
                            ? "历史节点 · 已锁定"
                            : locked
                              ? "未执行 · 暂不可编辑"
                              : "未执行 · 可编辑"}
                        </small>
                      </span>
                      <strong>{step.title}</strong>
                      <p>{step.instruction}</p>
                      <small>
                        {step.tool === "edit_design" ? "修改设计" : "生成设计"}
                        {saved?.selectedAssetId ? " · 已采用结果" : ""}
                      </small>
                    </button>
                    <button
                      className={styles.outputPort}
                      type="button"
                      disabled={busy || !canEdit}
                      aria-pressed={connectionFrom === step.key}
                      onClick={() => {
                        setConnectionFrom(step.key);
                        setError(null);
                      }}
                      aria-label={`连接「${step.title}」的输出`}
                      title="选择输出"
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <nav className={styles.mobileList} aria-label="移动端节点列表">
            {draft.map((step, index) => (
              <button
                key={step.key}
                type="button"
                aria-pressed={selected?.key === step.key}
                onClick={() => {
                  setSelectedKey(step.key);
                  setPathAssetId(null);
                }}
              >
                <b>{String(index + 1).padStart(2, "0")}</b>
                <span>
                  {step.title}
                  <small>
                    {step.sourceStepKey
                      ? `来源：${draft.find((source) => source.key === step.sourceStepKey)?.title}`
                      : step.sourceAssetId
                        ? "来源：设计资产"
                        : "来源：设计目标"}
                  </small>
                </span>
              </button>
            ))}
          </nav>
          <aside className={styles.properties} aria-label="节点属性">
            {pathAssetId ? (
              <>
                <button type="button" onClick={() => setPathAssetId(null)}>
                  返回节点属性
                </button>
                <DesignPathPanel assetId={pathAssetId} />
              </>
            ) : selected ? (
              <>
                <header>
                  <span>节点 {selectedIndex + 1}</span>
                  <h3>{selected.title}</h3>
                  <p>
                    {editable
                      ? "修改后统一保存节点图。"
                      : hasHistory
                        ? "已执行或有历史尝试的节点结构固定；提示词可在侧栏按权限调整。"
                        : "当前计划执行中或等待选择，未执行节点暂不可编辑。"}
                  </p>
                </header>
                <label htmlFor="graph-node-title">节点标题</label>
                <input
                  id="graph-node-title"
                  value={selected.title}
                  disabled={busy || !editable}
                  maxLength={100}
                  onChange={(event) =>
                    updateSelected({ title: event.target.value })
                  }
                />
                <label htmlFor="graph-node-tool">节点工具</label>
                <select
                  id="graph-node-tool"
                  value={selected.tool}
                  disabled={busy || !editable}
                  onChange={(event) =>
                    updateSelected(
                      event.target.value === "generate_design"
                        ? {
                            tool: "generate_design",
                            sourceAssetId: null,
                            sourceStepKey: null,
                          }
                        : { tool: "edit_design" },
                    )
                  }
                >
                  <option value="generate_design">生成设计</option>
                  <option value="edit_design">修改设计</option>
                </select>
                <label htmlFor="graph-node-source">输入来源</label>
                <select
                  id="graph-node-source"
                  value={sourceValue}
                  disabled={
                    busy || !editable || selected.tool === "generate_design"
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    updateSelected(
                      value.startsWith("step:")
                        ? { sourceStepKey: value.slice(5), sourceAssetId: null }
                        : value.startsWith("asset:")
                          ? {
                              sourceAssetId: value.slice(6),
                              sourceStepKey: null,
                            }
                          : { sourceAssetId: null, sourceStepKey: null },
                    );
                  }}
                >
                  <option value="">
                    {selected.tool === "generate_design"
                      ? "设计目标与参考素材"
                      : "请选择一个输入来源"}
                  </option>
                  {draft.slice(0, selectedIndex).map((step) => (
                    <option key={step.key} value={`step:${step.key}`}>
                      前序节点：{step.title}
                    </option>
                  ))}
                  {sourceAssets.map((asset, index) => (
                    <option
                      key={asset.assetId}
                      value={`asset:${asset.assetId}`}
                    >
                      参考设计资产 {index + 1}
                    </option>
                  ))}
                  {selected.sourceAssetId &&
                  !sourceAssets.some(
                    (asset) => asset.assetId === selected.sourceAssetId,
                  ) ? (
                    <option value={`asset:${selected.sourceAssetId}`}>
                      已保存的设计资产来源
                    </option>
                  ) : null}
                </select>
                <label htmlFor="graph-node-instruction">设计说明</label>
                <textarea
                  id="graph-node-instruction"
                  value={selected.instruction}
                  disabled={busy || !editable}
                  maxLength={2000}
                  onChange={(event) =>
                    updateSelected({ instruction: event.target.value })
                  }
                />
                <label htmlFor="graph-node-prompt">节点提示词</label>
                <textarea
                  id="graph-node-prompt"
                  value={selected.prompt}
                  disabled={busy || !editable}
                  maxLength={4000}
                  onChange={(event) =>
                    updateSelected({ prompt: event.target.value })
                  }
                />
                <label htmlFor="graph-node-negative">避免内容</label>
                <textarea
                  id="graph-node-negative"
                  value={selected.negativePrompt}
                  disabled={busy || !editable}
                  maxLength={3000}
                  onChange={(event) =>
                    updateSelected({ negativePrompt: event.target.value })
                  }
                />
                <div className={styles.nodeActions}>
                  <button
                    type="button"
                    disabled={busy || !editable || selectedIndex <= 0}
                    onClick={() =>
                      attemptChange(() =>
                        movePlanStep(draft, selected.key, -1, editableKeys),
                      )
                    }
                  >
                    上移节点
                  </button>
                  <button
                    type="button"
                    disabled={
                      busy || !editable || selectedIndex >= draft.length - 1
                    }
                    onClick={() =>
                      attemptChange(() =>
                        movePlanStep(draft, selected.key, 1, editableKeys),
                      )
                    }
                  >
                    下移节点
                  </button>
                  <button
                    className={styles.danger}
                    type="button"
                    disabled={busy || !editable}
                    onClick={() =>
                      attemptChange(() => removePlanStep(draft, selected.key))
                    }
                  >
                    删除节点
                  </button>
                </div>
                {historical?.attempts?.length ? (
                  <section className={styles.history} aria-label="节点尝试历史">
                    <h4>每次尝试与候选</h4>
                    {historical.attempts.map((attempt) => (
                      <details key={attempt.id}>
                        <summary>
                          尝试 {attempt.ordinal} ·{" "}
                          {attemptStatusLabel(attempt.status)}
                        </summary>
                        <p>
                          {new Date(attempt.createdAt).toLocaleString("zh-CN")}
                        </p>
                        <pre>{attempt.prompt}</pre>
                        {attempt.negativePrompt ? (
                          <p>避免：{attempt.negativePrompt}</p>
                        ) : null}
                        {attempt.error ? <p>{attempt.error}</p> : null}
                        {!attempt.candidates.length &&
                        ["succeeded", "rejected"].includes(attempt.status) ? (
                          <p>此轮产物已归档或暂不可访问</p>
                        ) : null}
                        <div>
                          {attempt.candidates.map((candidate) => (
                            <button
                              type="button"
                              key={candidate.assetId}
                              onClick={() => setPathAssetId(candidate.assetId)}
                              aria-label={`查看尝试 ${attempt.ordinal} 的设计路径`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={candidate.thumbnailUrl ?? candidate.url}
                                alt={`尝试 ${attempt.ordinal} 候选`}
                              />
                              <span>设计路径</span>
                            </button>
                          ))}
                        </div>
                      </details>
                    ))}
                  </section>
                ) : null}
              </>
            ) : (
              <p>请选择一个设计节点。</p>
            )}
          </aside>
        </div>
        <footer className={styles.footer}>
          <div>
            {error ? (
              <p role="alert">{error}</p>
            ) : validation && dirty ? (
              <p role="status">{validation}</p>
            ) : (
              <p>
                {dirty
                  ? "节点图有未保存修改，执行前请先保存。"
                  : `${draft.length} 个节点 · 每次只执行一步`}
              </p>
            )}
          </div>
          {confirmClose ? (
            <div className={styles.closeConfirm}>
              <span>有未保存修改。</span>
              <button type="button" onClick={() => setConfirmClose(false)}>
                继续编辑
              </button>
              <button
                className={styles.danger}
                type="button"
                onClick={() => {
                  onDirtyChange(false);
                  onClose();
                }}
              >
                放弃修改并关闭
              </button>
            </div>
          ) : (
            <>
              <button type="button" disabled={busy || !dirty} onClick={reset}>
                放弃未保存修改
              </button>
              <button
                className={styles.primary}
                type="button"
                disabled={
                  busy || !canEdit || !dirty || Boolean(validation) || stale
                }
                onClick={() => void save()}
              >
                {busy ? "正在保存…" : "保存节点图"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
