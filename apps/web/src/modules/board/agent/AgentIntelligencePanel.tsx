"use client";
import { GridDetails } from "../../../components/GridDetails";

import type {
  AgentDesignConstraint,
  AgentDesignIntelligence,
  AgentDomainActionView,
  AgentNodeRationale,
  AgentRunStepView,
  FashionDesignDimension,
} from "@fashion/shared";
import styles from "./agent-intelligence.module.css";

const DIMENSION_LABELS: Record<FashionDesignDimension, string> = {
  silhouette: "廓形",
  structure: "结构",
  material: "面料",
  color: "色彩",
  style: "风格",
  function: "功能",
  presentation: "展示方式",
};
const MODE_LABELS = {
  require: "要求",
  preserve: "保留",
  change: "调整",
  avoid: "避免",
} as const;
const CHECK_LABELS = {
  met: "图像观察符合",
  concern: "发现偏离",
  unknown: "待确认",
} as const;
const ACTION_LABELS: Record<AgentDomainActionView["status"], string> = {
  running: "领域 Agent 分析中",
  completed: "分析已完成",
  failed: "分析失败，可重新尝试",
  superseded: "建议已失效，节点或结果已经更新",
  applied: "建议已应用",
};

export function AgentDesignBriefPanel({
  intelligence,
}: {
  readonly intelligence: AgentDesignIntelligence;
}) {
  const { brief, evidence, audit } = intelligence;
  const unassigned = brief.constraints.filter((constraint) =>
    audit.coverage.some(
      (item) =>
        item.constraintId === constraint.id && item.status === "unassigned",
    ),
  );
  const focus = brief.constraints
    .filter((constraint) => constraint.origin === "explicit")
    .slice(0, 2)
    .map((constraint) => constraint.requirement);
  return (
    <GridDetails className={styles.brief}>
      <summary>
        <span>设计简报 {brief.constraints.length} 项条件</span>
        <small className={styles.briefPreview}>
          {focus.length ? `规划条件：${focus.join(" ")}` : `设计目标：${brief.summary}`}
        </small>
      </summary>
      <div className={styles.body}>
        <p>{brief.summary}</p>
        {brief.garmentType ? <p>服装品类：{brief.garmentType}</p> : null}
        <ConstraintGroup
          title="你明确提出的要求"
          constraints={brief.constraints.filter(
            (item) => item.origin === "explicit",
          )}
          intelligence={intelligence}
        />
        <ConstraintGroup
          title="Agent 对需求的解释"
          constraints={brief.constraints.filter(
            (item) => item.origin === "interpretation",
          )}
          intelligence={intelligence}
        />
        {brief.unknowns.length ? (
          <section>
            <h4>还需你确认的条件</h4>
            <TextList items={brief.unknowns} />
          </section>
        ) : null}
        {unassigned.length ? (
          <section className={styles.warning}>
            <h4>计划尚未绑定的要求</h4>
            <TextList items={unassigned.map((item) => item.requirement)} />
          </section>
        ) : null}
        {audit.warnings.length ? <TextList items={audit.warnings} /> : null}
        <p className={styles.caveat}>
          节点绑定表示计划覆盖这些条件，实际结果仍需逐项检查并由你确认。
        </p>
        <GridDetails>
          <summary>查看来源证据</summary>
          {evidence.length ? (
            <ol className={styles.evidence}>
              {evidence.map((item) => (
                <li key={item.id}>
                  <strong>{item.label}</strong>
                  <small>
                    {item.kind === "intent"
                      ? "设计需求"
                      : item.kind === "board"
                        ? "白板素材"
                        : "设计师决策"}
                  </small>
                  <p>{item.text}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p>没有可展示的来源证据。</p>
          )}
        </GridDetails>
      </div>
    </GridDetails>
  );
}

function ConstraintGroup({
  title,
  constraints,
  intelligence,
}: {
  readonly title: string;
  readonly constraints: readonly AgentDesignConstraint[];
  readonly intelligence: AgentDesignIntelligence;
}) {
  if (!constraints.length) return null;
  return (
    <section>
      <h4>{title}</h4>
      <ul className={styles.constraints}>
        {constraints.map((constraint) => (
          <li key={constraint.id}>
            <span className={styles.meta}>
              {DIMENSION_LABELS[constraint.dimension]} {" "}
              {MODE_LABELS[constraint.mode]} {" "}
              {constraint.priority === "must" ? "必须" : "偏好"}
            </span>
            <p>{constraint.requirement}</p>
            {constraint.sourceQuote ? (
              <blockquote>{constraint.sourceQuote}</blockquote>
            ) : null}
            <small>
              {constraint.verification === "requires_measurement"
                ? "需要测量确认"
                : constraint.verification === "requires_specification"
                  ? "需要规格或材料资料确认"
                  : "可从图像检查"}
            </small>
            {constraint.evidenceIds.length ? (
              <small>
                依据：
                {constraint.evidenceIds
                  .map(
                    (id) =>
                      intelligence.evidence.find((item) => item.id === id)
                        ?.label ?? "来源暂不可用",
                  )
                  .join("、")}
              </small>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AgentNodeRationalePanel({
  rationale,
  intelligence,
}: {
  readonly rationale: AgentNodeRationale | undefined;
  readonly intelligence: AgentDesignIntelligence | undefined;
}) {
  if (!rationale || !intelligence) return null;
  const constraints = rationale.constraintIds.map((id) =>
    intelligence.brief.constraints.find((item) => item.id === id),
  );
  return (
    <GridDetails className={styles.rationale}>
      <summary>本节点的设计依据</summary>
      <div className={styles.body}>
        <p>{rationale.goal}</p>
        {constraints.length ? (
          <section>
            <h4>关联设计条件</h4>
            <TextList
              items={constraints.map(
                (item) => item?.requirement ?? "该条件记录暂不可用",
              )}
            />
          </section>
        ) : null}
        {rationale.acceptanceChecks.length ? (
          <section>
            <h4>结果确认时检查</h4>
            <TextList items={rationale.acceptanceChecks} />
          </section>
        ) : null}
        <p className={styles.caveat}>
          这是本步的规划依据，结果是否符合由实际候选与人工选择确认。
        </p>
      </div>
    </GridDetails>
  );
}

export function CandidateAgentCheck({
  intelligence,
  step,
  assetId,
  number,
  busy,
  onCheck,
}: {
  readonly intelligence: AgentDesignIntelligence;
  readonly step: AgentRunStepView;
  readonly assetId: string;
  readonly number: number;
  readonly busy: boolean;
  readonly onCheck: () => void;
}) {
  const action = latestAgentDomainAction(
    intelligence,
    "evaluate_candidate",
    step.id,
    assetId,
  );
  const current =
    step.status === "waiting_review" &&
    step.candidates.some((candidate) => candidate.assetId === assetId);
  const evaluation = action?.evaluation;
  return (
    <section
      className={styles.candidate}
      aria-label={`结果 ${number} 的领域检查`}
    >
      <div className={styles.actionHeader}>
        <strong>结果 {number} 领域检查</strong>
        {current ? (
          <button
            type="button"
            disabled={
              busy ||
              action?.status === "running" ||
              action?.status === "completed"
            }
            onClick={onCheck}
          >
            {action?.status === "failed" || action?.status === "superseded"
              ? "重新检查"
              : action?.status === "running"
                ? "检查中…"
                : "领域 Agent 检查"}
          </button>
        ) : null}
      </div>
      {action ? (
        <ActionStatus action={action} />
      ) : (
        <p className={styles.caveat}>
          按设计条件检查这张候选，供你决定是否采用。
        </p>
      )}
      {evaluation ? (
        <GridDetails open={action?.status === "completed"}>
          <summary>查看逐项检查</summary>
          <div className={styles.body}>
            <p>{evaluation.summary}</p>
            <ul className={styles.checks}>
              {evaluation.checks.map((check) => (
                <li key={check.constraintId} data-status={check.status}>
                  <strong>
                    {intelligence.brief.constraints.find(
                      (constraint) => constraint.id === check.constraintId,
                    )?.requirement ?? "设计条件记录暂不可用"}
                  </strong>
                  <span className={styles.checkStatus}>
                    {CHECK_LABELS[check.status]}
                  </span>
                  <p>{check.observation}</p>
                </li>
              ))}
            </ul>
            {evaluation.nextActions.length ? (
              <section>
                <h4>后续建议</h4>
                <TextList items={evaluation.nextActions} />
              </section>
            ) : null}
            <p className={styles.caveat}>
              Agent
              检查是图像观察建议；尺寸、性能与制作可行性仍需资料或实测。最终由你决定采用。
            </p>
          </div>
        </GridDetails>
      ) : null}
    </section>
  );
}

export function AgentStepRefinement({
  intelligence,
  step,
  eligible,
  busy,
  dirty,
  onRequest,
  onApply,
}: {
  readonly intelligence: AgentDesignIntelligence;
  readonly step: AgentRunStepView;
  readonly eligible: boolean;
  readonly busy: boolean;
  readonly dirty: boolean;
  readonly onRequest: () => void;
  readonly onApply: (actionId: string) => void;
}) {
  const action = latestAgentDomainAction(intelligence, "refine_step", step.id);
  const refinement = action?.refinement;
  const changed = Boolean(
    refinement &&
    (step.prompt !== refinement.originalPrompt ||
      step.negativePrompt !== refinement.originalNegativePrompt),
  );
  const staleAttempt = Boolean(
    refinement && step.attempts?.at(-1)?.id !== refinement.attemptId,
  );
  const unchanged = Boolean(
    refinement &&
    refinement.prompt === refinement.originalPrompt &&
    refinement.negativePrompt === refinement.originalNegativePrompt,
  );
  if (!eligible && !action) return null;
  return (
    <section className={styles.refinement} aria-label="针对反馈的节点修订">
      <div className={styles.actionHeader}>
        <strong>根据反馈调整本节点</strong>
        {eligible ? (
          <button
            type="button"
            disabled={
              busy ||
              dirty ||
              action?.status === "running" ||
              (action?.status === "completed" && !changed && !staleAttempt)
            }
            onClick={onRequest}
          >
            {action?.status === "running"
              ? "提出修订中…"
              : action
                ? "重新提出修订"
                : "根据反馈提出修订"}
          </button>
        ) : null}
      </div>
      {action ? (
        <ActionStatus action={action} />
      ) : (
        <p>分析最近一次反馈，先提出提示词修订，再由你决定是否应用。</p>
      )}
      {dirty ? (
        <p className={styles.warning}>
          请先保存节点修改，再请求或应用修订建议。
        </p>
      ) : null}
      {refinement ? (
        <GridDetails open={action?.status === "completed"}>
          <summary>查看修订前后与保留项</summary>
          <div className={styles.body}>
            <p>{refinement.summary}</p>
            <section>
              <h4>针对性调整</h4>
              <TextList items={refinement.changes} />
            </section>
            <section>
              <h4>继续保留</h4>
              <TextList items={refinement.preserve} />
            </section>
            <div className={styles.promptComparison}>
              <section>
                <h4>修订前提示词</h4>
                <pre>{refinement.originalPrompt}</pre>
                {refinement.originalNegativePrompt ? (
                  <p>避免：{refinement.originalNegativePrompt}</p>
                ) : null}
              </section>
              <section>
                <h4>建议提示词</h4>
                <pre>{refinement.prompt}</pre>
                {refinement.negativePrompt ? (
                  <p>避免：{refinement.negativePrompt}</p>
                ) : null}
              </section>
            </div>
            {(changed || staleAttempt) && action?.status === "completed" ? (
              <p className={styles.warning}>
                节点已被修改，请根据保存后的提示词重新提出修订。
              </p>
            ) : null}
            {unchanged ? (
              <p className={styles.caveat}>
                此次分析保留现有提示词，无需应用。请根据说明处理执行问题，再主动重试。
              </p>
            ) : null}
            {action?.status === "completed" && !unchanged ? (
              <button
                className={styles.apply}
                type="button"
                disabled={busy || dirty || !eligible || changed || staleAttempt}
                onClick={() => onApply(action.id)}
              >
                应用修订建议
              </button>
            ) : null}
            <p className={styles.caveat}>
              应用只更新本节点提示词，不会自动生成。准备好后再主动执行。
            </p>
          </div>
        </GridDetails>
      ) : null}
    </section>
  );
}

function ActionStatus({ action }: { readonly action: AgentDomainActionView }) {
  return (
    <div className={styles.actionStatus} data-status={action.status}>
      <p role="status">{ACTION_LABELS[action.status]}</p>
      {action.error ? <p>{action.error}</p> : null}
    </div>
  );
}

function TextList({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className={styles.textList}>
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

export function latestAgentDomainAction(
  intelligence: AgentDesignIntelligence,
  kind: AgentDomainActionView["kind"],
  stepId: string,
  assetId?: string,
): AgentDomainActionView | undefined {
  return intelligence.actions
    .map((action, index) => ({ action, index }))
    .filter(
      ({ action }) =>
        action.kind === kind &&
        action.stepId === stepId &&
        (assetId === undefined || action.assetId === assetId),
    )
    .toSorted(
      (a, b) =>
        b.action.createdAt.localeCompare(a.action.createdAt) ||
        b.index - a.index,
    )[0]?.action;
}
