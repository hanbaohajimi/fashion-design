"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type {
  DesignDecisionKind,
  DesignPathStep,
  DesignSourceSnapshot,
} from "@fashion/shared";
import { fetchDesignPath, recordDesignDecision } from "./generation-api";
import styles from "./generation.module.css";

const TOOL_LABELS: Record<string, string> = {
  t2i: "生成设计",
  i2i: "设计变体",
  inpaint: "局部重绘",
  imported: "导入素材",
  generated: "生成设计",
  variation: "设计变体",
  restore: "恢复已有结果",
  upscale: "高清放大",
};
const ROLE_LABELS: Record<string, string> = {
  garment_ref: "参考衣",
  reference_garment: "参考衣",
  style_ref: "风格参考",
  fabric_ref: "面料",
  palette: "色卡",
  silhouette_ref: "廓形",
  detail_ref: "细节",
  avoid: "避免项",
  note: "设计要求",
  edit_source: "编辑来源",
  restore_source: "恢复来源",
  import_source: "上传素材",
};
const DECISION_LABELS: Record<DesignDecisionKind, string> = {
  selected: "选定此方案",
  rejected: "否决此方案",
  compare: "保留比较",
};

export function DesignPathPanel({ assetId }: { readonly assetId: string }) {
  const queryClient = useQueryClient();
  const path = useQuery({
    queryKey: ["design-asset-path", assetId],
    queryFn: () => fetchDesignPath(assetId),
  });
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const request = useRef<{
    kind: DesignDecisionKind;
    reason: string;
    id: string;
  } | null>(null);
  const decision = useMutation({
    mutationFn: (kind: DesignDecisionKind) => {
      const normalized = reason.trim();
      if (
        request.current?.kind !== kind ||
        request.current.reason !== normalized
      ) {
        request.current = { kind, reason: normalized, id: crypto.randomUUID() };
      }
      return recordDesignDecision(
        assetId,
        kind,
        normalized,
        request.current.id,
      );
    },
    onSuccess: async () => {
      request.current = null;
      await queryClient.invalidateQueries({ queryKey: ["design-asset-path"] });
    },
  });
  const steps = path.data?.steps ?? [];
  const selected =
    steps.find((step) => step.id === selectedStepId) ??
    steps.find((step) => step.outputs.some((output) => output.id === assetId));
  const latest = path.data?.decisions.find((item) => item.assetId === assetId);
  const error =
    path.error instanceof Error ? path.error.message : "设计路径读取失败";
  const sourceStep = (source: DesignSourceSnapshot) =>
    steps.find((step) =>
      step.outputs.some((output) => output.id === source.assetId),
    );

  return (
    <section className={styles.designPath} aria-label="设计路径">
      <header>
        <div>
          <span>DESIGN PROCESS</span>
          <h3>从来源到设计结果</h3>
        </div>
        <p>点击操作节点查看当时的输入与约束。放上白板与选定方案分别记录。</p>
      </header>
      {path.isPending ? (
        <p role="status">正在读取设计路径…</p>
      ) : path.isError ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => void path.refetch()} type="button">
            重新读取
          </button>
        </div>
      ) : (
        <>
          {path.data?.incomplete ? (
            <p className={styles.pathNotice}>
              部分来源已不可用，或路径超过展示上限；当前只展示能够核实的记录。
            </p>
          ) : null}
          <div className={styles.pathGraph} aria-label="设计步骤节点图">
            {steps.map((step, index) => (
              <div className={styles.pathRow} key={step.id}>
                <div className={styles.pathSources}>
                  <span>输入来源</span>
                  {step.sources.length ? (
                    step.sources.map((source, sourceIndex) => (
                      <button
                        key={`${source.elementId}-${sourceIndex}`}
                        type="button"
                        aria-label={`${ROLE_LABELS[source.role] ?? source.role}：${source.title}`}
                        disabled={!sourceStep(source)}
                        onClick={() =>
                          setSelectedStepId(sourceStep(source)?.id ?? null)
                        }
                      >
                        <small>{ROLE_LABELS[source.role] ?? source.role}</small>
                        <strong>{source.title}</strong>
                        {source.text ? <p>{source.text}</p> : null}
                      </button>
                    ))
                  ) : (
                    <p>{step.snapshotAvailable ? "文本需求" : "来源未记录"}</p>
                  )}
                </div>
                <button
                  className={styles.pathOperation}
                  type="button"
                  aria-pressed={selected?.id === step.id}
                  onClick={() => setSelectedStepId(step.id)}
                >
                  <span>
                    步骤 {index + 1} {" "}
                    {step.actor === "agent"
                      ? "Agent"
                      : step.actor === "collection"
                        ? "系列扩展"
                        : step.actor === "legacy"
                          ? "历史记录"
                          : "手动操作"}
                  </span>
                  <strong>{TOOL_LABELS[step.tool] ?? step.tool}</strong>
                  <p>{step.intent}</p>
                  <small>
                    {step.snapshotAvailable ? "已保存输入快照" : "历史快照缺失"}
                  </small>
                </button>
                <div className={styles.pathOutputs}>
                  <span>输出结果</span>
                  {step.outputs.map((output) => (
                    <button
                      type="button"
                      key={output.id}
                      onClick={() => setSelectedStepId(step.id)}
                      aria-label={
                        output.id === assetId
                          ? "当前设计结果"
                          : `查看步骤 ${index + 1} 的结果`
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={output.thumbnailUrl ?? output.url}
                        alt={
                          output.id === assetId
                            ? "当前设计"
                            : `${TOOL_LABELS[step.tool] ?? step.tool}结果`
                        }
                      />
                      <small>
                        {output.id === assetId ? "当前设计" : "设计结果"}
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {selected ? (
            <StepDetails step={selected} />
          ) : (
            <p>尚无可展示的步骤。</p>
          )}
          <section className={styles.pathDecision} aria-label="设计师决策">
            <div>
              <strong>这张设计的选择记录</strong>
              <span role="status">
                {latest ? DECISION_LABELS[latest.kind] : "尚未作出明确选择"}
              </span>
            </div>
            <label htmlFor={`decision-reason-${assetId}`}>
              选择理由（可选）
            </label>
            <textarea
              id={`decision-reason-${assetId}`}
              maxLength={1000}
              value={reason}
              disabled={decision.isPending}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：保留面料表现，下一步调整袖口"
            />
            <div className={styles.pathDecisionActions}>
              {(Object.keys(DECISION_LABELS) as DesignDecisionKind[]).map(
                (kind) => (
                  <button
                    key={kind}
                    type="button"
                    disabled={decision.isPending}
                    onClick={() => decision.mutate(kind)}
                  >
                    {DECISION_LABELS[kind]}
                  </button>
                ),
              )}
            </div>
            {decision.isPending ? <p role="status">正在保存选择…</p> : null}
            {decision.isError ? (
              <p role="alert">
                {decision.error instanceof Error
                  ? decision.error.message
                  : "保存失败，请重试"}
              </p>
            ) : null}
            {latest?.reason ? <p>最近的理由：{latest.reason}</p> : null}
            <details>
              <summary>查看历史选择</summary>
              <ol>
                {path.data?.decisions
                  .filter((item) => item.assetId === assetId)
                  .map((item) => (
                    <li key={item.id}>
                      {DECISION_LABELS[item.kind]} {" "}
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                      {item.reason ? `：${item.reason}` : ""}
                    </li>
                  ))}
              </ol>
            </details>
          </section>
        </>
      )}
    </section>
  );
}

function StepDetails({ step }: { readonly step: DesignPathStep }) {
  const values = [
    ["色彩约束", step.constraints.palette],
    ["设计要求", step.constraints.notes],
    ["面料描述", step.constraints.fabricTerms],
    ["避免项", step.constraints.avoidLabels],
  ] as const;
  return (
    <section className={styles.pathDetails} aria-label="步骤详情">
      <h4>{TOOL_LABELS[step.tool] ?? step.tool} 当时的设计条件</h4>
      <p>{step.intent}</p>
      {!step.snapshotAvailable ? (
        <p>这项历史操作未保存完整输入快照，无法核实当时的全部条件。</p>
      ) : null}
      <dl>
        {values
          .filter(([, items]) => items.length)
          .map(([label, items]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{items.join("；")}</dd>
            </div>
          ))}
      </dl>
      {Object.keys(step.parameters).length ? (
        <details>
          <summary>查看执行参数与提示词</summary>
          <pre>{JSON.stringify(step.parameters, null, 2)}</pre>
        </details>
      ) : null}
      <time dateTime={step.createdAt}>
        {new Date(step.createdAt).toLocaleString("zh-CN")}
      </time>
    </section>
  );
}
