"use client";

import type {
  AgentDesignIntelligence,
  AgentDomainActionView,
  AgentPlanStepSpec,
  AgentRunStepView,
  AgentRunView,
} from "@fashion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AgentRunApiError,
  applyAgentDomainAction,
  controlAgentRun,
  createAgentRun,
  fetchAgentRun,
  listAgentRuns,
  requestAgentDomainAction,
  MAX_AGENT_MESSAGE_LENGTH,
  updateAgentRunStep,
  updateAgentRunPlan,
  validateAgentMessage,
} from "./agent-api";
import styles from "./board-agent-panel.module.css";
import { AgentPlanEditor } from "./AgentPlanEditor";
import { attemptStatusLabel } from "./agent-plan-graph";
import {
  AgentDesignBriefPanel,
  AgentNodeRationalePanel,
  AgentStepRefinement,
  CandidateAgentCheck,
  latestAgentDomainAction,
} from "./AgentIntelligencePanel";

const RUN_LABELS: Record<AgentRunView["status"], string> = {
  planning: "正在规划",
  ready: "等待执行",
  running: "节点执行中",
  waiting_review: "等待你选择结果",
  paused: "已暂停",
  completed: "设计计划已完成",
  failed: "节点执行失败",
  canceled: "已取消",
};
const STEP_LABELS: Record<AgentRunStepView["status"], string> = {
  pending: "尚未执行",
  running: "正在生成",
  waiting_review: "等待选择",
  succeeded: "已完成",
  failed: "执行失败",
  canceled: "已取消",
};

export interface AgentWorkflowPanelProps {
  readonly conversationId: string;
  readonly contextReady: boolean;
  readonly contextItems: ReactNode;
  readonly initialIntent: string;
  readonly shapeIds: readonly string[];
  readonly onTaskCreated: (taskId: string) => Promise<void>;
}

export function AgentWorkflowPanel({
  conversationId,
  contextReady,
  contextItems,
  initialIntent,
  shapeIds,
  onTaskCreated,
}: AgentWorkflowPanelProps) {
  const client = useQueryClient();
  const [intent, setIntent] = useState(initialIntent);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphDirty, setGraphDirty] = useState(false);
  const [planningRequested, setPlanningRequested] = useState(false);
  const [domainRequested, setDomainRequested] = useState(false);
  const [dirtyStepIds, setDirtyStepIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const createRequest = useRef<{ key: string; id: string } | null>(null);
  const trackedTaskIds = useRef(new Set<string>());
  const submittedCommand = useRef<string | null>(null);
  const submittedDomain = useRef<string | null>(null);
  const submittedApply = useRef<string | null>(null);
  const domainRequests = useRef(
    new Map<
      string,
      { id: string; revision: number; baselineActionId: string | null }
    >(),
  );
  const listKey = ["agent-runs", conversationId] as const;
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => listAgentRuns(conversationId),
    refetchInterval: (query) =>
      planningRequested ||
      query.state.data?.items.some((item) => item.status === "planning")
        ? 2_000
        : false,
  });
  const activeRunId = selectedRunId ?? list.data?.items[0]?.id ?? null;
  const detail = useQuery({
    queryKey: ["agent-run", activeRunId],
    queryFn: () => fetchAgentRun(activeRunId ?? ""),
    enabled: Boolean(activeRunId),
    refetchInterval: (query) => {
      const run = query.state.data;
      return run &&
        (domainRequested ||
          run.intelligence?.actions.some(
            (action) => action.status === "running",
          ) ||
          run.status === "planning" ||
          run.status === "running" ||
          run.steps.some((step) => step.status === "running"))
        ? 2_000
        : false;
    },
  });
  const listedRun = list.data?.items.find((item) => item.id === activeRunId);
  const run = detail.data ?? listedRun;
  const markStepDirty = useCallback((stepId: string, dirty: boolean): void => {
    setDirtyStepIds((current) => {
      if (current.has(stepId) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(stepId);
      else next.delete(stepId);
      return next;
    });
  }, []);

  const storeRun = (updated: AgentRunView, select = true): void => {
    client.setQueryData(["agent-run", updated.id], updated);
    client.setQueryData<{ readonly items: readonly AgentRunView[] }>(
      listKey,
      (current) => ({
        items: [
          updated,
          ...(current?.items ?? []).filter((item) => item.id !== updated.id),
        ],
      }),
    );
    if (select) setSelectedRunId(updated.id);
    setNotice(null);
  };
  const refreshAfterFailure = (cause: Error): void => {
    if (cause instanceof AgentRunApiError && cause.status === 409) {
      void detail.refetch();
    }
  };
  const create = useMutation({
    mutationFn: async () => {
      const validation = validateAgentMessage(intent, shapeIds.length);
      if (validation) throw new Error(validation);
      if (!contextReady) throw new Error("所选素材正在保存，保存完成后再规划");
      const key = JSON.stringify({ intent: intent.trim(), shapeIds });
      if (createRequest.current?.key !== key) {
        createRequest.current = { key, id: crypto.randomUUID() };
      }
      setPlanningRequested(true);
      setSelectedRunId(null);
      return createAgentRun(conversationId, {
        clientRequestId: createRequest.current.id,
        content: intent.trim(),
        fileAssetIds: [],
        shapeIds,
      });
    },
    onSuccess: (updated) => {
      storeRun(updated);
      createRequest.current = null;
      setComposing(false);
    },
    onSettled: () => setPlanningRequested(false),
  });
  const control = useMutation({
    mutationFn: (input: {
      readonly action: "execute" | "review" | "reject" | "pause" | "cancel";
      readonly assetId?: string;
      readonly reason?: string;
    }) => {
      if (!run) throw new Error("请先读取设计计划");
      return controlAgentRun(run.id, input.action, {
        revision: run.revision,
        ...(input.assetId ? { assetId: input.assetId } : {}),
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      });
    },
    onSuccess: (updated) => storeRun(updated),
    onError: refreshAfterFailure,
  });
  const edit = useMutation({
    mutationFn: (input: {
      readonly stepId: string;
      readonly prompt: string;
      readonly negativePrompt: string;
    }) => {
      if (!run) throw new Error("请先读取设计计划");
      return updateAgentRunStep(run.id, input.stepId, {
        revision: run.revision,
        prompt: input.prompt.trim(),
        negativePrompt: input.negativePrompt.trim(),
      });
    },
    onSuccess: (updated) => storeRun(updated),
    onError: refreshAfterFailure,
  });
  const editPlan = useMutation({
    mutationFn: (input: {
      readonly steps: readonly AgentPlanStepSpec[];
      readonly revision: number;
    }) => {
      if (!run) throw new Error("请先读取设计计划");
      return updateAgentRunPlan(run.id, input);
    },
    onSuccess: (updated) => storeRun(updated),
    onError: refreshAfterFailure,
  });
  const domain = useMutation({
    mutationFn: (input: {
      readonly key: string;
      readonly runId: string;
      readonly request: Parameters<typeof requestAgentDomainAction>[1];
    }) => {
      setDomainRequested(true);
      return requestAgentDomainAction(input.runId, input.request);
    },
    onSuccess: (updated, input) => {
      domainRequests.current.delete(input.key);
      storeRun(updated, false);
    },
    onError: (cause, input) => {
      submittedDomain.current = null;
      if (cause instanceof AgentRunApiError && cause.status === 409)
        domainRequests.current.delete(input.key);
      refreshAfterFailure(cause);
    },
    onSettled: () => setDomainRequested(false),
  });
  const apply = useMutation({
    mutationFn: (input: {
      readonly runId: string;
      readonly actionId: string;
      readonly revision: number;
    }) =>
      applyAgentDomainAction(input.runId, input.actionId, {
        revision: input.revision,
      }),
    onSuccess: (updated) => storeRun(updated, false),
    onError: (cause) => {
      submittedApply.current = null;
      refreshAfterFailure(cause);
    },
  });
  const submitControl = (input: {
    readonly action: "execute" | "review" | "reject" | "pause" | "cancel";
    readonly assetId?: string;
    readonly reason?: string;
  }): void => {
    if (!run || control.isPending || edit.isPending) return;
    const key = `${run.id}:${run.revision}:${input.action}`;
    if (submittedCommand.current === key) return;
    submittedCommand.current = key;
    control.mutate(input, {
      onError: () => {
        if (submittedCommand.current === key) submittedCommand.current = null;
      },
    });
  };

  useEffect(() => {
    for (const step of run?.steps ?? []) {
      const taskId = step.generationTaskId;
      if (!taskId || trackedTaskIds.current.has(taskId)) continue;
      trackedTaskIds.current.add(taskId);
      void onTaskCreated(taskId).catch(() => {
        trackedTaskIds.current.delete(taskId);
        setNotice("任务已提交，白板同步暂有延迟；可刷新状态重试");
      });
    }
  }, [onTaskCreated, run]);

  const busy =
    control.isPending ||
    edit.isPending ||
    editPlan.isPending ||
    create.isPending;
  const terminal = run?.status === "completed" || run?.status === "canceled";
  const hasDirtySteps =
    run?.steps.some((step) => dirtyStepIds.has(step.id)) ?? false;
  const actionBusy =
    domain.isPending ||
    apply.isPending ||
    Boolean(
      run?.intelligence?.actions.some((action) => action.status === "running"),
    );
  const submitDomain = (
    step: AgentRunStepView,
    kind: AgentDomainActionView["kind"],
    assetId?: string,
  ): void => {
    if (!run?.intelligence || busy || actionBusy) return;
    if (kind === "refine_step" && (hasDirtySteps || graphDirty)) return;
    const latest = step.attempts?.at(-1);
    const key = JSON.stringify([
      run.id,
      kind,
      step.id,
      assetId ?? null,
      latest?.id ?? step.generationTaskId,
      ...(kind === "refine_step" ? [step.prompt, step.negativePrompt] : []),
    ]);
    const command = `${run.revision}:${key}`;
    if (submittedDomain.current === command) return;
    submittedDomain.current = command;
    const previous = domainRequests.current.get(key);
    const latestAction = latestAgentDomainAction(
      run.intelligence,
      kind,
      step.id,
      assetId,
    );
    const request =
      previous &&
      !(
        latestAction?.status === "failed" &&
        latestAction.id !== previous.baselineActionId
      )
        ? previous
        : {
            id: crypto.randomUUID(),
            revision: run.revision,
            baselineActionId: latestAction?.id ?? null,
          };
    domainRequests.current.set(key, request);
    domain.mutate({
      key,
      runId: run.id,
      request: {
        revision: request.revision,
        clientRequestId: request.id,
        kind,
        stepId: step.id,
        ...(assetId ? { assetId } : {}),
      },
    });
  };
  const submitApply = (step: AgentRunStepView, actionId: string): void => {
    if (!run || busy || actionBusy || hasDirtySteps || graphDirty) return;
    const action = run.intelligence?.actions.find(
      (item) => item.id === actionId,
    );
    const refinement = action?.refinement;
    if (
      action?.status !== "completed" ||
      !refinement ||
      refinement.attemptId !== step.attempts?.at(-1)?.id ||
      refinement.originalPrompt !== step.prompt ||
      refinement.originalNegativePrompt !== step.negativePrompt ||
      (refinement.prompt === refinement.originalPrompt &&
        refinement.negativePrompt === refinement.originalNegativePrompt)
    )
      return;
    const key = `${run.id}:${run.revision}:${actionId}`;
    if (submittedApply.current === key) return;
    submittedApply.current = key;
    apply.mutate({ runId: run.id, actionId, revision: run.revision });
  };
  const reviewStep = run?.steps.find(
    (step) => step.status === "waiting_review",
  );
  const nextStep = run?.steps.find(
    (step) => step.status === "pending" || step.status === "failed",
  );
  const executable =
    Boolean(nextStep) &&
    !reviewStep &&
    run &&
    !run.steps.some((step) => step.status === "running") &&
    ["ready", "paused", "failed"].includes(run.status);
  const error =
    create.error ??
    control.error ??
    edit.error ??
    editPlan.error ??
    domain.error ??
    apply.error;

  return (
    <section className={styles.workflowPanel} aria-label="设计工作流">
      <header className={styles.workflowIntro}>
        <div>
          <span>DESIGN WORKFLOW</span>
          <strong>逐步推进你的设计</strong>
        </div>
        <p>先确认节点，执行一步、查看结果，再决定是否继续。</p>
      </header>
      {list.isPending ? (
        <div className={styles.workflowSkeleton} role="status">
          <span>正在恢复设计计划…</span>
          <i />
          <i />
        </div>
      ) : list.isError ? (
        <div className={styles.workflowError} role="alert">
          <p>{errorText(list.error, "设计计划读取失败")}</p>
          <button onClick={() => void list.refetch()} type="button">
            重新读取计划
          </button>
        </div>
      ) : (
        <>
          {list.data?.items.length ? (
            <div className={styles.workflowSelector}>
              <label htmlFor={`workflow-history-${conversationId}`}>
                设计计划
              </label>
              <select
                id={`workflow-history-${conversationId}`}
                value={activeRunId ?? ""}
                disabled={busy}
                onChange={(event) => {
                  setSelectedRunId(event.target.value);
                  setComposing(false);
                  control.reset();
                  edit.reset();
                }}
              >
                {list.data.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.intent} · {RUN_LABELS[item.status]}
                  </option>
                ))}
              </select>
              <button
                disabled={busy}
                type="button"
                onClick={() => {
                  setComposing((current) => !current);
                  create.reset();
                }}
              >
                {composing ? "收起目标" : "新建计划"}
              </button>
            </div>
          ) : null}
          {composing || !list.data?.items.length ? (
            <form
              className={styles.workflowComposer}
              onSubmit={(event) => {
                event.preventDefault();
                if (!create.isPending) create.mutate();
              }}
            >
              <label htmlFor={`workflow-intent-${conversationId}`}>
                设计目标
              </label>
              <textarea
                id={`workflow-intent-${conversationId}`}
                disabled={create.isPending}
                value={intent}
                maxLength={MAX_AGENT_MESSAGE_LENGTH}
                placeholder="例如：从宽松风衣开始，逐步调整廓形，再强化面料质感"
                onChange={(event) => setIntent(event.target.value)}
              />
              {contextItems}
              <p>
                {shapeIds.length
                  ? `已选 ${shapeIds.length} 项白板素材。`
                  : "可先选择白板上的参考素材。"}
                规划完成后，由你逐步确认执行。
              </p>
              <button
                className={styles.workflowPrimary}
                disabled={busy || !intent.trim() || !contextReady}
                type="submit"
              >
                {create.isPending ? "正在规划…" : "规划设计步骤"}
              </button>
            </form>
          ) : null}
          {run ? (
            <>
              <div className={styles.workflowStatus}>
                <span role="status">{RUN_LABELS[run.status]}</span>
                <button
                  type="button"
                  disabled={busy || detail.isFetching}
                  onClick={() => {
                    control.reset();
                    edit.reset();
                    void detail.refetch();
                  }}
                >
                  刷新状态
                </button>
              </div>
              <p className={styles.workflowIntent}>{run.intent}</p>
              {run.intelligence ? (
                <AgentDesignBriefPanel intelligence={run.intelligence} />
              ) : run.steps.length > 0 ? (
                <p className={styles.workflowLegacyNotice}>
                  此计划创建于设计简报升级前。若要逐项检查候选并根据反馈获得修订建议，请点击上方“新建计划”。
                </p>
              ) : null}
              <button
                type="button"
                disabled={busy || hasDirtySteps}
                onClick={() => {
                  editPlan.reset();
                  setGraphOpen(true);
                }}
              >
                打开节点图工作区
              </button>
              {detail.isError ? (
                <p className={styles.error} role="alert">
                  {errorText(detail.error, "状态同步失败，请刷新重试")}
                </p>
              ) : null}
              {run.error ? <p className={styles.error}>{run.error}</p> : null}
              <ol className={styles.workflowNodes} aria-label="计划节点">
                {run.steps.map((step, index) => (
                  <WorkflowNode
                    key={step.id}
                    step={step}
                    number={index + 1}
                    sourceTitle={
                      step.sourceStepKey
                        ? (run.steps.find(
                            (source) => source.key === step.sourceStepKey,
                          )?.title ?? "前序节点")
                        : step.sourceAssetId
                          ? "所选设计资产"
                          : null
                    }
                    editable={
                      (step.canEditInputs ?? step.status === "pending") &&
                      ["ready", "paused", "failed"].includes(run.status)
                    }
                    busy={busy || run.status === "running"}
                    intelligence={run.intelligence}
                    actionBusy={actionBusy}
                    allDirty={hasDirtySteps || graphDirty}
                    onDomain={(kind, assetId) =>
                      submitDomain(step, kind, assetId)
                    }
                    onApply={(actionId) => submitApply(step, actionId)}
                    onDirtyChange={markStepDirty}
                    onSave={async (prompt, negativePrompt) => {
                      await edit.mutateAsync({
                        stepId: step.id,
                        prompt,
                        negativePrompt,
                      });
                    }}
                    onReview={(assetId, reason) =>
                      submitControl({ action: "review", assetId, reason })
                    }
                    onReject={(reason) =>
                      submitControl({ action: "reject", reason })
                    }
                  />
                ))}
              </ol>
              {!terminal ? (
                <footer className={styles.workflowControls}>
                  {executable ? (
                    <button
                      className={styles.workflowPrimary}
                      type="button"
                      disabled={
                        busy || detail.isError || hasDirtySteps || graphDirty
                      }
                      onClick={() => submitControl({ action: "execute" })}
                    >
                      {nextStep?.status === "failed"
                        ? "重试当前节点"
                        : run.status === "paused"
                          ? "继续执行下一节点"
                          : "执行下一节点"}
                    </button>
                  ) : null}
                  {["ready", "running", "failed"].includes(run.status) ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => submitControl({ action: "pause" })}
                    >
                      暂停计划
                    </button>
                  ) : null}
                  <button
                    className={styles.workflowCancel}
                    type="button"
                    disabled={control.isPending || edit.isPending}
                    onClick={() => submitControl({ action: "cancel" })}
                  >
                    取消计划
                  </button>
                </footer>
              ) : null}
              {hasDirtySteps ? (
                <p className={styles.error} role="status">
                  有未保存的节点提示词，请先保存后再执行。
                </p>
              ) : null}
            </>
          ) : activeRunId && detail.isPending ? (
            <p role="status">正在恢复节点…</p>
          ) : null}
        </>
      )}
      {busy && !create.isPending ? (
        <p role="status">正在保存工作流状态…</p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {errorText(error, "操作失败，请重试")}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.error} role="status">
          {notice}
        </p>
      ) : null}
      {run && graphOpen ? (
        <AgentPlanEditor
          run={run}
          busy={busy}
          onDirtyChange={setGraphDirty}
          onClose={() => setGraphOpen(false)}
          onSave={async (steps, revision) =>
            editPlan.mutateAsync({ steps, revision })
          }
        />
      ) : null}
    </section>
  );
}

function WorkflowNode({
  step,
  number,
  sourceTitle,
  editable,
  busy,
  onSave,
  onReview,
  onDirtyChange,
  onReject,
  intelligence,
  actionBusy,
  allDirty,
  onDomain,
  onApply,
}: {
  readonly step: AgentRunStepView;
  readonly number: number;
  readonly sourceTitle: string | null;
  readonly editable: boolean;
  readonly busy: boolean;
  readonly onSave: (prompt: string, negativePrompt: string) => Promise<void>;
  readonly onReview: (assetId: string, reason: string) => void;
  readonly onDirtyChange: (stepId: string, dirty: boolean) => void;
  readonly onReject: (reason: string) => void;
  readonly intelligence: AgentDesignIntelligence | undefined;
  readonly actionBusy: boolean;
  readonly allDirty: boolean;
  readonly onDomain: (
    kind: AgentDomainActionView["kind"],
    assetId?: string,
  ) => void;
  readonly onApply: (actionId: string) => void;
}) {
  const [draft, setDraft] = useState<{
    prompt: string;
    negativePrompt: string;
  } | null>(null);
  const prompt = editable ? (draft?.prompt ?? step.prompt) : step.prompt;
  const negativePrompt = editable
    ? (draft?.negativePrompt ?? step.negativePrompt)
    : step.negativePrompt;
  const reviewKey = JSON.stringify([
    step.generationTaskId,
    step.candidates.map((candidate) => candidate.assetId),
  ]);
  const [selection, setSelection] = useState({
    key: reviewKey,
    assetId: step.selectedAssetId ?? "",
    reason: "",
  });
  const selectedAssetId =
    selection.key === reviewKey &&
    step.candidates.some((candidate) => candidate.assetId === selection.assetId)
      ? selection.assetId
      : "";
  const reason = selection.key === reviewKey ? selection.reason : "";
  const dirty = editable && draft !== null;
  useEffect(() => {
    onDirtyChange(step.id, dirty);
    return () => onDirtyChange(step.id, false);
  }, [dirty, onDirtyChange, step.id]);
  const updateDraft = (
    nextPrompt: string,
    nextNegativePrompt: string,
  ): void => {
    setDraft(
      nextPrompt === step.prompt && nextNegativePrompt === step.negativePrompt
        ? null
        : { prompt: nextPrompt, negativePrompt: nextNegativePrompt },
    );
  };
  const saveDraft = async (): Promise<void> => {
    try {
      await onSave(prompt, negativePrompt);
      setDraft(null);
    } catch {
      // 保存失败时保留草稿，错误由工作流面板显示。
    }
  };
  return (
    <li className={styles.workflowNode} data-status={step.status}>
      <div className={styles.workflowNodeMeta}>
        <span>{String(number).padStart(2, "0")}</span>
        <small>
          {step.selectedAssetId ? "已采用" : STEP_LABELS[step.status]}
        </small>
      </div>
      <h3>{step.title}</h3>
      <p>{step.instruction}</p>
      <div className={styles.workflowSource}>
        <span>{step.tool === "edit_design" ? "修改设计" : "生成设计"}</span>
        {sourceTitle ? (
          <span>输入 ← {sourceTitle}</span>
        ) : (
          <span>输入 ← 设计目标与参考素材</span>
        )}
      </div>
      <AgentNodeRationalePanel
        rationale={intelligence?.rationales.find(
          (item) => item.stepKey === step.key,
        )}
        intelligence={intelligence}
      />
      <details className={styles.workflowPrompt}>
        <summary>
          {editable ? "查看或修改节点提示词" : "查看执行提示词"}
        </summary>
        <label htmlFor={`step-prompt-${step.id}`}>节点提示词</label>
        <textarea
          id={`step-prompt-${step.id}`}
          value={prompt}
          readOnly={!editable}
          disabled={busy}
          maxLength={4_000}
          onChange={(event) => updateDraft(event.target.value, negativePrompt)}
        />
        <label htmlFor={`step-negative-${step.id}`}>避免内容</label>
        <textarea
          id={`step-negative-${step.id}`}
          value={negativePrompt}
          readOnly={!editable}
          disabled={busy}
          maxLength={3_000}
          onChange={(event) => updateDraft(prompt, event.target.value)}
        />
        {editable ? (
          <button
            type="button"
            disabled={busy || !dirty || !prompt.trim()}
            onClick={() => void saveDraft()}
          >
            保存节点提示词
          </button>
        ) : null}
      </details>
      {step.error ? <p className={styles.error}>{step.error}</p> : null}
      {step.status === "running" ? (
        <p className={styles.workflowTaskNotice}>
          成图会放到白板，完成后可在此选择结果。
        </p>
      ) : null}
      {step.candidates.length ? (
        <fieldset className={styles.workflowResults} disabled={busy}>
          <legend>
            {step.status === "waiting_review"
              ? "选择用于后续设计的结果"
              : "节点结果"}
          </legend>
          <div>
            {step.candidates.map((candidate, index) => (
              <label
                key={candidate.assetId}
                data-selected={candidate.assetId === selectedAssetId}
              >
                {step.status === "waiting_review" ? (
                  <input
                    type="radio"
                    name={`result-${step.id}`}
                    value={candidate.assetId}
                    checked={selectedAssetId === candidate.assetId}
                    onChange={() =>
                      setSelection({
                        key: reviewKey,
                        assetId: candidate.assetId,
                        reason,
                      })
                    }
                    aria-label={`选择节点 ${number} 的结果 ${index + 1}`}
                  />
                ) : null}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={candidate.thumbnailUrl ?? candidate.url}
                  alt={`节点 ${number} 的设计结果 ${index + 1}`}
                />
                <span>
                  {candidate.assetId === step.selectedAssetId
                    ? "已采用"
                    : `结果 ${index + 1}`}
                </span>
              </label>
            ))}
          </div>
          {intelligence
            ? step.candidates
                .filter(
                  (candidate) =>
                    step.status === "waiting_review" ||
                    intelligence.actions.some(
                      (action) =>
                        action.kind === "evaluate_candidate" &&
                        action.stepId === step.id &&
                        action.assetId === candidate.assetId,
                    ),
                )
                .map((candidate, index) => (
                  <CandidateAgentCheck
                    key={candidate.assetId}
                    intelligence={intelligence}
                    step={step}
                    assetId={candidate.assetId}
                    number={index + 1}
                    busy={busy || actionBusy}
                    onCheck={() =>
                      onDomain("evaluate_candidate", candidate.assetId)
                    }
                  />
                ))
            : null}
          {step.status === "waiting_review" ? (
            <>
              <label htmlFor={`review-reason-${step.id}`}>
                选择或调整理由（否决时必填）
              </label>
              <textarea
                id={`review-reason-${step.id}`}
                value={reason}
                maxLength={1_000}
                onChange={(event) =>
                  setSelection({
                    key: reviewKey,
                    assetId: selectedAssetId,
                    reason: event.target.value,
                  })
                }
                placeholder="例如：保留廓形，下一步强化织物表现"
              />
              <button
                className={styles.workflowPrimary}
                type="button"
                disabled={busy || !selectedAssetId}
                onClick={() => onReview(selectedAssetId, reason)}
              >
                采用结果并完成节点
              </button>
              <button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => onReject(reason.trim())}
              >
                结果不满意，重新调整
              </button>
              <p>
                重新调整需要填写原因。当前候选会记为否决，下一次生成由你主动执行。
              </p>
              <p>确认后可继续下一节点。成图已经放到白板。</p>
            </>
          ) : null}
        </fieldset>
      ) : null}
      {intelligence ? (
        <AgentStepRefinement
          intelligence={intelligence}
          step={step}
          eligible={
            editable &&
            Boolean(
              step.attempts?.at(-1) &&
              ["rejected", "failed"].includes(
                step.attempts.at(-1)?.status ?? "",
              ),
            )
          }
          busy={busy || actionBusy}
          dirty={allDirty}
          onRequest={() => onDomain("refine_step")}
          onApply={onApply}
        />
      ) : null}
      {step.attempts?.length ? (
        <details className={styles.workflowPrompt}>
          <summary>查看每次尝试与反馈</summary>
          {step.attempts.map((attempt) => (
            <section key={attempt.id}>
              <strong>
                尝试 {attempt.ordinal} · {attemptStatusLabel(attempt.status)}
              </strong>
              <p>
                {attempt.status === "rejected" ? "调整原因：" : ""}
                {attempt.error}
              </p>
              <pre>{attempt.prompt}</pre>
              <p>
                {!attempt.candidates.length &&
                ["succeeded", "rejected"].includes(attempt.status)
                  ? "此轮产物已归档或暂不可访问"
                  : `${attempt.candidates.length} 个候选，历史产物可在节点图中查看设计路径。`}
              </p>
            </section>
          ))}
        </details>
      ) : null}
    </li>
  );
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
