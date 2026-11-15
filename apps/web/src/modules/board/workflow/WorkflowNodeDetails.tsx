"use client";
import { usePersistentDraft } from "../../../components/drafts/use-persistent-draft";

import { Select } from "../../../components/ui";
import { GridDetails } from "../../../components/GridDetails";

import { useEffect, useRef, useState } from "react";
import {
  getWorkflowToolContract,
  isRetiredWorkflowTool,
  parseWorkflowToolParameters,
  WORKFLOW_TOOL_KEYS,
  type WorkflowToolKey,
  type AgentDesignBrief,
  type AgentDesignEvaluation,
} from "@fashion/shared";
import {
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowInputPort,
  type WorkflowAttempt,
  decideWorkflowCandidate,
  executeWorkflowNode,
  fetchWorkflowNodeHistory,
} from "./workflow-api";
import {
  displayNodeTitle,
  incomingEdges,
  outgoingEdges,
  lineageOf,
  nodeImageUrl,
  nodeSummary,
  nodeTypeLabel,
} from "./workflow-graph";
import { DesignPathPanel } from "../generation/DesignPathPanel";
import { Badge, Button } from "../../../components/ui";
import { TaskFeedback } from "../../../components/TaskFeedback";
import {
  isTaskActive,
  taskState,
} from "../../../components/task-feedback-state";
import { userFacingError } from "../../../components/user-facing-error";
import { WorkflowDialog } from "./WorkflowDialog";
import styles from "./workflow-canvas.module.css";
import { useWorkspaceDraft } from "./workspace-drafts";
import { TryOnReferenceEntry } from "./TryOnReferenceEntry";
import { WardrobeReferenceEntry } from "./WardrobeReferenceEntry";
import { projectCanvasMedia, mediaDuration } from "./canvas-media";

const PORT_LABELS: Readonly<Record<WorkflowInputPort, string>> = {
  candidate: "设计图",
  constraint: "设计约束",
  goal: "设计目标",
  reference: "参考素材",
  source: "原图",
};

export function NodeDetails({
  embedded = false,
  readOnly = false,
  placementOnly = false,
  graph,
  node,
  onCreateCollection,
  onOpenAsset,
  onDelete,
  path,
  projectId,
  onGraphChange,
  onSavePayload,
  onEnsureConversation,
  setError,
  onDirtyChange,
}: {
  readonly embedded?: boolean;
  readonly readOnly?: boolean;
  readonly placementOnly?: boolean;
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
  readonly graph: WorkflowGraph;
  readonly node: WorkflowNode | null;
  readonly onCreateCollection: (
    nodeId: string,
    assetId: string,
  ) => Promise<void>;
  readonly onOpenAsset: (assetId: string) => void;
  readonly onDelete: (nodeId: string) => Promise<void>;
  readonly path: ReturnType<typeof lineageOf> | null;
  readonly projectId: string;
  readonly onGraphChange: (next: WorkflowGraph) => void;
  readonly onSavePayload: (
    nodeId: string,
    payload: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
  readonly onEnsureConversation: () => Promise<string>;
  readonly setError: (message: string | null) => void;
}) {
  const [decisionKind, setDecisionKind] = useState<
    "selected" | "rejected" | "compare"
  >("selected");
  const [decisionReason, setDecisionReason] = useState("");
  const [toolDirty, setToolDirty] = useState(false);
  useWorkspaceDraft("decision", { decisionKind, decisionReason }, Boolean(decisionReason.trim()));
  usePersistentDraft({ value: { decisionKind, decisionReason }, baseline: JSON.stringify({ decisionKind: "selected", decisionReason: "" }), objectKey: `decision:${node?.id ?? "new"}`, restore: draft => { setDecisionKind(draft.decisionKind); setDecisionReason(draft.decisionReason); } });
  useEffect(() => {
    onDirtyChange?.(toolDirty || Boolean(decisionReason.trim()));
  }, [decisionReason, onDirtyChange, toolDirty]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!node)
    return (
      <div className={styles.sideEmpty}>
        <span>◌</span>
        <h3>选择画布节点</h3>
        <p>查看来源、输入、输出与可执行操作。</p>
      </div>
    );
  const assetId =
    typeof node.payload.assetId === "string" ? node.payload.assetId : null;
  const inputs = incomingEdges(graph, node.id);
  const outputs = outgoingEdges(graph, node.id);
  const state = taskState(node.status);
  const summary = nodeSummary(node);
  const media = projectCanvasMedia(node, projectId);
  const nodeError =
    typeof node.payload.error === "string" ? node.payload.error : null;
  const brief =
    node.type === "constraint" &&
    node.payload.brief &&
    typeof node.payload.brief === "object"
      ? (node.payload.brief as AgentDesignBrief)
      : null;
  const report =
    node.type === "evaluation" &&
    node.payload.report &&
    typeof node.payload.report === "object"
      ? (node.payload.report as {
          readonly evaluations?: readonly AgentDesignEvaluation[];
        })
      : null;
  return (
    <div className={styles.detailScroll} data-workspace={embedded}>
      {!embedded && nodeTypeLabel(node.type) !== displayNodeTitle(node) ? (
        <span className={styles.overline}>{nodeTypeLabel(node.type)}</span>
      ) : null}
      {!embedded ? <h3>{displayNodeTitle(node)}</h3> : null}
      {node.kind === "tool" &&
      (isTaskActive(node.status) || state.state === "failed") ? (
        <TaskFeedback
          visual
          motionKey={`node:${node.id}`}
          taskId={`${projectId}:${node.id}`}
          status={node.status}
          updatedAt={node.updatedAt}
          error={nodeError}
          operation={
            node.type === "edit_design"
              ? "edit"
              : node.type === "generate_design"
                ? "generate"
                : "analysis"
          }
        />
      ) : !embedded && (node.kind === "tool" || state.state === "unknown") ? (
        <Badge tone={state.state === "complete" ? "success" : "neutral"}>
          {state.label}
        </Badge>
      ) : null}
      {summary && summary !== node.title && !(embedded && node.kind === "tool") ? (
        <p className={styles.detailSummary}>{summary}</p>
      ) : null}
      {media ? <section className={styles.detailSection} aria-label="媒体来源">
        <h4>{media.props.mediaKind === "video" ? "视频记录" : "音频记录"}</h4>
        {mediaDuration(media.props.durationMs) ? <p>时长 {mediaDuration(media.props.durationMs)}</p> : null}
        <p>在白板卡片中播放或下载原文件。引用媒体记录不会自动分析视频画面或音频内容。</p>
        <a href={media.props.sourceHref}>回到服装秀来源</a>
      </section> : null}
      {nodeImageUrl(node) && !(embedded && node.type === "candidate") ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={node.title}
          className={styles.detailImage}
          src={nodeImageUrl(node)}
        />
      ) : null}
      {node.type === "reference_image" || node.type === "sketch" ? (
        <section className={styles.detailSection}>
          {node.type === "reference_image" && typeof node.payload.fileAssetId === "string" ? <TryOnReferenceEntry
            key={node.payload.fileAssetId}
            projectId={projectId}
            fileAssetId={node.payload.fileAssetId}
            canEdit={!readOnly && node.canEditPayload === true}
          /> : null}
          {node.type === "reference_image" && typeof node.payload.fileAssetId === "string" ? <WardrobeReferenceEntry
            key={`wardrobe:${node.payload.fileAssetId}`}
            projectId={projectId}
            fileAssetId={node.payload.fileAssetId}
            canEdit={!readOnly && node.canEditPayload === true}
          /> : null}
        </section>
      ) : null}
      {brief ? (
        <section className={styles.detailSection}>
          <h4>设计约束</h4>
          {brief.constraints.map((constraint) => (
            <div className={styles.constraintRow} key={constraint.id}>
              <span>
                {constraint.priority === "must" ? "必须" : "偏好"} {" "}
                {constraint.origin === "explicit" ? "明确提出" : "解释性建议"}
              </span>
              <p>{constraint.requirement}</p>
              <small>
                {constraint.verification === "visual"
                  ? "可由图像判断"
                  : "需实测或规格确认"}
              </small>
            </div>
          ))}
          {brief.unknowns.length > 0 ? (
            <p>待确认：{brief.unknowns.join("；")}</p>
          ) : null}
        </section>
      ) : null}
      {report?.evaluations ? (
        <section className={styles.detailSection}>
          <h4>逐图评估</h4>
          {report.evaluations.map((evaluation) => (
            <div className={styles.constraintRow} key={evaluation.assetId}>
              <strong>
                {graph.nodes.find(
                  (item) => item.payload.assetId === evaluation.assetId,
                )?.title ?? "设计方案"}
              </strong>
              <p>{evaluation.summary}</p>
              {evaluation.checks.map((check) => (
                <p key={check.constraintId}>
                  {check.status === "met"
                    ? "✓ 符合"
                    : check.status === "concern"
                      ? "! 存疑"
                      : "? 无法判断"}{" "}
                  {check.observation}
                </p>
              ))}
            </div>
          ))}
        </section>
      ) : null}
      {!readOnly && !embedded && (node.type === "sketch" || node.type === "swatch") ? (
        <Button
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("fashion-workflow:node-details", {
                detail: node.id,
              }),
            )
          }
        >
          {node.type === "sketch" ? "编辑草图" : "编辑色卡"}
        </Button>
      ) : null}
      {node.kind === "tool" ? (
        <section className={styles.detailSection}>
          <h4>输入素材</h4>
          {inputs.length ? inputs.map((edge) => <p key={edge.id}>{PORT_LABELS[edge.targetPort]} {displayNodeTitle(graph.nodes.find((item) => item.id === edge.sourceNodeId) ?? { title: "未知节点", type: "legacy" })}</p>) : <p>尚未连接输入素材。</p>}
        <ToolSettings
          readOnly={readOnly}
          graph={graph}
          inputs={inputs.length}
          key={node.id}
          onDirtyChange={setToolDirty}
          node={node}
          onEnsureConversation={onEnsureConversation}
          onGraphChange={onGraphChange}
          onSavePayload={onSavePayload}
          projectId={projectId}
          setError={setError}
        />
          <h4>执行结果</h4>
          {outputs.length ? outputs.map((edge) => { const result = graph.nodes.find((item) => item.id === edge.targetNodeId); return result ? <p key={edge.id}>{displayNodeTitle(result)} {nodeSummary(result)}</p> : null; }) : <p>执行完成后，结果会出现在这里和画布中。</p>}
        </section>
      ) : null}
      {node.type === "candidate" && assetId ? (
        <section className={styles.detailSection}>
          <h4>设计方案</h4>
          {!embedded ? <button onClick={() => onOpenAsset(assetId)} type="button">
            打开大图、版本与局部重绘
          </button> : null}
          <h4>设计师决定</h4>
          <Select
            aria-label="设计师决定"
            disabled={readOnly}
            onChange={(event) =>
              setDecisionKind(event.target.value as typeof decisionKind)
            }
            value={decisionKind}
          >
            <option value="selected">选定方案</option>
            <option value="compare">保留比较</option>
            <option value="rejected">否决方案</option>
          </Select>
          <textarea
            readOnly={readOnly}
            className={styles.decisionReason}
            onChange={(event) => setDecisionReason(event.target.value)}
            placeholder="记录选择或否决理由"
            rows={3}
            value={decisionReason}
          />
          <button
            disabled={readOnly || !decisionReason.trim()}
            onClick={() =>
              void decideWorkflowCandidate(
                projectId,
                node.id,
                assetId,
                decisionKind,
                decisionReason.trim(),
              )
                .then((next) => {
                  onGraphChange(next);
                  setDecisionReason("");
                })
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error ? cause.message : "决定保存失败",
                  ),
                )
            }
            type="button"
          >
            保存决定
          </button>
        </section>
      ) : null}
      {assetId && node.type === "candidate" ? (
        <section className={styles.detailSection}>
          <h4>系列</h4>
          <button
            disabled={readOnly}
            onClick={() => void onCreateCollection(node.id, assetId)}
            type="button"
          >
            {typeof node.payload.collectionId === "string"
              ? "打开关联系列"
              : "设为主推款并建立系列"}
          </button>
        </section>
      ) : null}
      <GridDetails className={styles.detailSection}>
        <summary>来源与路径</summary>
        <div className={styles.detailMeta}>
          <span>输入</span>
          <strong>{inputs.length}</strong>
          <span>输出</span>
          <strong>{outputs.length}</strong>
        </div>
        {inputs.map((edge) => (
          <p key={edge.id}>
            {PORT_LABELS[edge.targetPort]} {" "}
            {displayNodeTitle(
              graph.nodes.find((item) => item.id === edge.sourceNodeId) ?? {
                title: "未知节点",
                type: "legacy",
              },
            )}
          </p>
        ))}
        {path && path.nodeIds.size > 1 ? (
          <ol>
            {graph.nodes
              .filter((item) => path.nodeIds.has(item.id))
              .map((item) => (
                <li key={item.id}>{displayNodeTitle(item)}</li>
              ))}
          </ol>
        ) : null}
        {assetId ? <DesignPathPanel assetId={assetId} readOnly={readOnly} /> : null}
      </GridDetails>
      <section className={styles.detailSection}>
        <button
          className={styles.dangerButton}
          disabled={readOnly || (placementOnly ? node.kind !== "asset" : node.canDelete !== true)}
          onClick={() => setConfirmingDelete(true)}
          type="button"
        >
          {placementOnly ? "从白板移除摆放" : "从工作流移除节点"}
        </button>
        {!placementOnly && node.canDelete !== true ? (
          <p>
            {node.deleteDisabledReason ??
              "当前节点不可移除，请刷新以读取最新权限。"}
          </p>
        ) : null}
      </section>
      {confirmingDelete ? (
        <WorkflowDialog
          label="确认移除节点"
          onClose={() => {
            if (!deleting) setConfirmingDelete(false);
          }}
        >
          <div className={styles.entryDialog}>
            <h2>移除「{displayNodeTitle(node)}」？</h2>
            <p>
              {placementOnly ? "移除此处的摆放，素材、版本与执行历史继续保留。可以使用白板撤销恢复摆放。" : `同时移除 ${inputs.length + outputs.length} 条关联连线。此操作不能撤销，原始设计资产会保留。`}
            </p>
            <button
              autoFocus
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
              type="button"
            >
              保留节点
            </button>
            <button
              className={styles.dangerButton}
              disabled={deleting}
              onClick={() => {
                setDeleting(true);
                void onDelete(node.id)
                  .then(() => setConfirmingDelete(false))
                  .catch((cause: unknown) =>
                    setError(
                      cause instanceof Error ? cause.message : "节点移除失败",
                    ),
                  )
                  .finally(() => setDeleting(false));
              }}
              type="button"
            >
              {deleting ? "正在移除…" : "确认移除"}
            </button>
          </div>
        </WorkflowDialog>
      ) : null}
    </div>
  );
}

interface ToolDraft {
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly count: string;
  readonly width: string;
  readonly height: string;
  readonly quality: string;
  readonly referenceInputs: readonly {
    readonly nodeId: string;
  }[];
}

function toolParams(node: WorkflowNode): Readonly<Record<string, unknown>> {
  const value = node.payload.params;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function toolDraft(node: WorkflowNode): ToolDraft {
  const params = toolParams(node);
  const defaults = WORKFLOW_TOOL_KEYS.includes(node.type as WorkflowToolKey)
    ? getWorkflowToolContract(node.type as WorkflowToolKey).defaults
    : {};
  return {
    prompt: typeof params.prompt === "string" ? params.prompt : "",
    negativePrompt:
      typeof params.negativePrompt === "string" ? params.negativePrompt : "",
    count: String(params.count ?? defaults.count ?? 1),
    width: String(params.width ?? defaults.width ?? 768),
    height: String(params.height ?? defaults.height ?? 1024),
    quality: String(params.quality ?? defaults.quality ?? "high"),
    referenceInputs: Array.isArray(params.referenceInputs)
      ? params.referenceInputs.flatMap((value) => {
          const reference = value && typeof value === "object" ? value as Record<string, unknown> : {};
          return typeof reference.nodeId === "string" ? [{ nodeId: reference.nodeId }] : [];
        })
      : [],
  };
}

export function ToolSettings({
  readOnly,
  onDirtyChange,
  graph,
  inputs,
  node,
  onGraphChange,
  onSavePayload,
  onEnsureConversation,
  projectId,
  setError,
  onExecute,
  draftMode = false,
  referenceNodeIds,
}: {
  readonly onExecute?: () => Promise<void>;
  readonly draftMode?: boolean;
  readonly referenceNodeIds?: readonly string[];
  readonly readOnly: boolean;
  readonly graph: WorkflowGraph;
  readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
  readonly inputs: number;
  readonly node: WorkflowNode;
  readonly onGraphChange: (next: WorkflowGraph) => void;
  readonly onSavePayload: (
    nodeId: string,
    payload: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
  readonly projectId: string;
  readonly setError: (message: string | null) => void;
  readonly onEnsureConversation: () => Promise<string>;
}) {
  const original = toolDraft(node);
  const [draft, setDraft] = useState<ToolDraft>(original);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const executeLock = useRef(false);
  const previousOriginal = useRef(JSON.stringify(original));
  const originalSignature = JSON.stringify(original);
  const draftSignature = JSON.stringify(draft);
  useEffect(() => {
    if (originalSignature !== previousOriginal.current) {
      if (draftSignature === previousOriginal.current)
        setDraft(JSON.parse(originalSignature) as ToolDraft);
      previousOriginal.current = originalSignature;
    }
  }, [originalSignature, draftSignature]);
  const [history, setHistory] = useState<readonly WorkflowAttempt[] | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const retired = isRetiredWorkflowTool(node.type);
  const canEdit = !readOnly && !retired && node.status === "ready" && node.type !== "restore_version";
  const imageTool =
    node.type === "generate_design" || node.type === "edit_design";
  const dirty =
    draft.prompt !== original.prompt ||
    (imageTool &&
      (draft.negativePrompt !== original.negativePrompt ||
        draft.width !== original.width ||
        draft.height !== original.height ||
        draft.quality !== original.quality ||
        draft.count !== original.count ||
        JSON.stringify(draft.referenceInputs) !==
          JSON.stringify(original.referenceInputs)));
  useWorkspaceDraft("tool", draft, dirty, saving || executing);
  usePersistentDraft({ value: draft, restore: setDraft, baseline: originalSignature, objectKey: `tool:${node.id}`, enabled: canEdit });
  useEffect(() => {
    onDirtyChange?.(canEdit && dirty);
  }, [canEdit, dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const referenceNodes = graph.nodes.filter(
    (source) =>
      (referenceNodeIds?.includes(source.id) ?? graph.edges.some(
        (edge) =>
          edge.targetNodeId === node.id &&
          edge.targetPort === "reference" &&
          edge.sourceNodeId === source.id,
      )) && Boolean(nodeImageUrl(source)),
  );

  const save = async () => {
    if (!canEdit || !dirty || saving) return;
    let nextParams: Record<string, unknown> = {
      ...toolParams(node),
      prompt: draft.prompt.trim(),
    };
    if (imageTool) {
      nextParams.negativePrompt = draft.negativePrompt.trim();
      nextParams.width = Number(draft.width);
      nextParams.height = Number(draft.height);
      nextParams.count = Number(draft.count);
      nextParams.quality = draft.quality;
      nextParams.referenceInputs = draft.referenceInputs;
    }
    try {
      if (WORKFLOW_TOOL_KEYS.includes(node.type as WorkflowToolKey)) {
        // Old manually drawn masks retain their existing trusted temporary URL; new parameters use the shared contract.
        const legacyMask =
          nextParams.taskType === "inpaint" &&
          typeof nextParams.maskImageUrl === "string"
            ? nextParams.maskImageUrl
            : null;
        if (legacyMask) {
          const validation: Record<string, unknown> = {
            ...nextParams,
            taskType: "i2i",
          };
          delete validation.maskImageUrl;
          const palette = validation.palette;
          delete validation.palette;
          const checked = parseWorkflowToolParameters(
            node.type as WorkflowToolKey,
            validation,
          );
          nextParams = {
            ...checked,
            taskType: "inpaint",
            maskImageUrl: legacyMask,
            ...(palette ? { palette } : {}),
          };
        } else
          nextParams = parseWorkflowToolParameters(
            node.type as WorkflowToolKey,
            nextParams,
          );
      }
    } catch {
      setLocalError(
        "参数不符合工具要求：数量为 1–4，宽高为 256–2048 且是 8 的倍数；请检查指令、质量及参考配置。",
      );
      return;
    }
    setSaving(true);
    setLocalError(null);
    try {
      await onSavePayload(node.id, { ...node.payload, params: nextParams });
      setDraft(
        toolDraft({
          ...node,
          payload: { ...node.payload, params: nextParams },
        }),
      );
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : "工具参数保存失败",
      );
    } finally {
      setSaving(false);
    }
  };

  const execute = async () => {
    if (executeLock.current) return;
    executeLock.current = true;
    setExecuting(true);
    try {
      if (onExecute) { await onExecute(); return; }
      const next = await executeWorkflowNode(
        projectId,
        node.id,
        await onEnsureConversation(),
      );
      onGraphChange(next);
      window.dispatchEvent(new Event("fashion-workflow:refresh"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "节点执行失败");
    } finally {
      executeLock.current = false;
      setExecuting(false);
    }
  };

  return (
    <section className={styles.detailSection}>
      <h4>工具设置</h4>
      <p>
        {retired ? "此旧流程已退役，原参数和历史结果仍可查看。新需求请在助手中讨论。" : canEdit
          ? "确认执行前可调整参数，保存后会记录到设计路径。"
          : "以下参数为该节点记录的设置；已运行节点不可修改。"}
      </p>
      {node.type === "edit_design" && !draftMode ? (
        <p>
          将要修改的设计图或上传图片连接为「原图」；其他图片可连接为「参考素材」。
        </p>
      ) : null}
      <div className={styles.toolForm}>
        <label>
          执行指令
          <textarea
            aria-label="执行指令"
            disabled={!canEdit || saving}
            maxLength={4000}
            onChange={(event) =>
              setDraft({ ...draft, prompt: event.target.value })
            }
            rows={3}
            value={draft.prompt}
          />
        </label>
        {imageTool ? (
          <GridDetails className={styles.advancedSettings}>
            <summary>
              <span>高级设置</span>
              <small>
                {" "}
                {draft.count} 张 {draft.width} × {draft.height} {" "}
                {draft.quality === "auto"
                  ? "自动质量"
                  : draft.quality === "high"
                    ? "高质量"
                    : draft.quality === "low"
                      ? "低质量"
                      : "标准质量"}
              </small>
            </summary>
            <label>
              排除内容
              <textarea
                aria-label="排除内容"
                disabled={!canEdit || saving}
                maxLength={3000}
                onChange={(event) =>
                  setDraft({ ...draft, negativePrompt: event.target.value })
                }
                rows={2}
                value={draft.negativePrompt}
              />
            </label>
            <div className={styles.toolDimensions}>
              <label>
                生成数量
                <input
                  aria-label="生成数量"
                  disabled={!canEdit || saving}
                  max={4}
                  min={1}
                  onChange={(event) =>
                    setDraft({ ...draft, count: event.target.value })
                  }
                  step={1}
                  type="number"
                  value={draft.count}
                />
              </label>
              <label>
                宽度
                <input
                  aria-label="宽度"
                  disabled={!canEdit || saving}
                  max={2048}
                  min={256}
                  onChange={(event) =>
                    setDraft({ ...draft, width: event.target.value })
                  }
                  step={8}
                  type="number"
                  value={draft.width}
                />
              </label>
              <label>
                高度
                <input
                  aria-label="高度"
                  disabled={!canEdit || saving}
                  max={2048}
                  min={256}
                  onChange={(event) =>
                    setDraft({ ...draft, height: event.target.value })
                  }
                  step={8}
                  type="number"
                  value={draft.height}
                />
              </label>
            </div>
            <label>
              图像质量
              <Select
                aria-label="图像质量"
                disabled={!canEdit || saving}
                onChange={(event) =>
                  setDraft({ ...draft, quality: event.target.value })
                }
                value={draft.quality}
              >
                <option value="auto">自动</option>
                <option value="low">低</option>
                <option value="medium">标准</option>
                <option value="high">高</option>
              </Select>
            </label>
            {referenceNodes.length ? (
              <div className={styles.referenceConfig} aria-label="本次引用">
                {referenceNodes.map((reference, index) => (
                  <span key={reference.id}>{index + 1} {displayNodeTitle(reference)}</span>
                ))}
              </div>
            ) : null}
          </GridDetails>
        ) : null}
      </div>
      {localError ? (
        <p className={styles.toolError} role="alert">
          {userFacingError(localError, "工具参数暂时无法保存，请重试")}
        </p>
      ) : null}
      <div className={styles.toolActions}>
        {canEdit ? (
          <Button
            variant={dirty ? "primary" : "secondary"}
            disabled={!dirty || saving}
            onClick={() => void save()}
            type="button"
          >
            {saving ? "正在保存…" : "保存工具参数"}
          </Button>
        ) : null}
        {!readOnly && !retired && node.type !== "restore_version" &&
        ["ready", "failed"].includes(node.status) ? (
          <Button
            variant={dirty ? "secondary" : "primary"}
            disabled={saving || executing || inputs === 0 || (canEdit && dirty)}
            onClick={() => void execute()}
            type="button"
          >
            {node.status === "failed" ? "重试执行" : "确认并执行"}
          </Button>
        ) : null}
        {canEdit && dirty ? (
          <p>请先保存参数，再确认执行。</p>
        ) : inputs === 0 ? (
          <p>{draftMode ? "请先在白板选择所需素材。" : "连接所需输入后即可执行。"}</p>
        ) : null}
      </div>
      {!draftMode ? <GridDetails className={styles.advancedSettings}>
        <summary>执行记录</summary>
        <button
          onClick={() =>
            void fetchWorkflowNodeHistory(projectId, node.id)
              .then((value) => setHistory(value.items))
              .catch((cause: unknown) =>
                setError(
                  cause instanceof Error ? cause.message : "执行历史读取失败",
                ),
              )
          }
          type="button"
        >
          读取尝试记录
        </button>
        {history ? (
          <ol className={styles.attemptList}>
            {history.length === 0 ? (
              <li>尚无执行记录</li>
            ) : (
              history.map((attempt) => (
                <li key={attempt.id}>
                  <strong>
                    第 {attempt.ordinal} 次 {taskState(attempt.status).label}
                  </strong>
                  <span>
                    {new Date(attempt.createdAt).toLocaleString("zh-CN")}
                  </span>
                  <p>
                    模型：
                    {typeof attempt.request.model === "string"
                      ? attempt.request.model
                      : "历史记录未提供"}
                  </p>
                  <p>
                    指令：
                    {typeof attempt.request.prompt === "string"
                      ? attempt.request.prompt
                      : typeof (
                            attempt.request.params as
                              Record<string, unknown> | undefined
                          )?.prompt === "string"
                        ? String(
                            (attempt.request.params as Record<string, unknown>)
                              .prompt,
                          )
                        : "未记录"}
                  </p>
                  {typeof attempt.request.negativePrompt === "string" &&
                  attempt.request.negativePrompt ? (
                    <p>排除内容：{attempt.request.negativePrompt}</p>
                  ) : null}
                  {typeof attempt.request.width === "number" &&
                  typeof attempt.request.height === "number" ? (
                    <p>
                      尺寸：{attempt.request.width} × {attempt.request.height}
                    </p>
                  ) : null}
                  {Array.isArray(attempt.request.inputNodeIds) ? (
                    <p>
                      来源：
                      {attempt.request.inputNodeIds
                        .map(
                          (id: unknown) =>
                            graph.nodes.find((item) => item.id === id)?.title ??
                            String(id),
                        )
                        .join("、") || "无"}
                    </p>
                  ) : null}
                  {attempt.error ? (
                    <p>
                      {userFacingError(attempt.error, "本次执行失败，可以重试")}
                    </p>
                  ) : null}
                </li>
              ))
            )}
          </ol>
        ) : null}
      </GridDetails> : null}
    </section>
  );
}
