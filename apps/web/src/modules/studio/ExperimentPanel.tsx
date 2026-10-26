"use client";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为稳定结果矩阵；320px 配置区提供母图与参数。保存计划为主操作，显式提交才启动生成。 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  experimentCreateSchema,
  type ExperimentCreateInput,
  type ExperimentView,
  type StudioAssetView,
  type StudioStyleView,
} from "@fashion/shared";
import { privateFetch } from "../auth/private-fetch";
import {
  Badge,
  Button,
  ImagePreview,
  Select,
  Textarea,
} from "../../components/ui";
import { StudioPageHeader } from "./StudioPageHeader";
import { TaskFeedback } from "../../components/TaskFeedback";
import { markMotion } from "../../components/motion/events";
import { isTaskActive } from "../../components/task-feedback-state";
import { userFacingError } from "../../components/user-facing-error";
import styles from "./experiments.module.css";
import { StudioEditSection } from "./StudioEditSection";
import { useStudioAssetName } from "./studio-object-context";

interface FabricOption {
  id: string;
  tags: string[];
  details?: { name?: string | null; appearanceNotes?: string | null } | null;
  mainImageUrl: string;
}
const stateLabel: Record<string, string> = {
  draft: "待提交",
  dispatching: "正在接纳",
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  not_admitted: "未接纳",
  canceled: "已取消",
};
async function request<T>(
  url: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const response = await privateFetch(url, {
    credentials: "include",
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          },
        }
      : {}),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(result?.message ?? "实验操作失败，请重试");
  }
  return response.json() as Promise<T>;
}
export function ExperimentPanel({
  projectId,
  assets,
  styles: styleRecords = [],
  canEdit = true,
  onRefresh,
  onDirty,
  initialMode = "color",
  initialSourceAssetId,
}: {
  projectId: string;
  assets: readonly StudioAssetView[];
  styles?: readonly StudioStyleView[];
  canEdit?: boolean;
  onRefresh?: () => void;
  onDirty?: (dirty: boolean) => void;
  initialMode?: ExperimentCreateInput["mode"];
  initialSourceAssetId?: string;
}) {
  const assetName = useStudioAssetName();
  const surfaceId = useId();
  const [resultFilter, setResultFilter] = useState("all");
  const matchesResult = (status: string) =>
    resultFilter === "all" ||
    (resultFilter === "active"
      ? ["draft", "queued", "dispatching", "running"].includes(status)
      : resultFilter === "failed"
        ? ["failed", "not_admitted"].includes(status)
        : status === resultFilter);
  const base =
    "/api/projects/" + encodeURIComponent(projectId) + "/experiments";
  const [mode, setMode] = useState<ExperimentCreateInput["mode"]>(initialMode);
  const [sourceAssetId, setSource] = useState(
    initialSourceAssetId
      ? (assets.find((asset) => asset.id === initialSourceAssetId)?.id ?? "")
      : (assets[0]?.id ?? ""),
  );
  const [prompt, setPrompt] = useState("保持原设计，仅完成指定的视觉修改");
  const [preserve, setPreserve] = useState(
    "保持廓形、领型、口袋、门襟、标识和服装主体结构",
  );
  const [colorText, setColorText] = useState(
    "墨黑 #202020\n海军蓝 #243A59\n米白 #E6DDCA",
  );
  const [variations, setVariations] = useState(
    initialMode === "presentation"
      ? "白色背景，服装平铺商品摄影\n简洁室内陈列场景，保持服装细节"
      : "修改为立领\n修改为翻领",
  );
  const [fabrics, setFabrics] = useState<FabricOption[]>([]);
  const [fabricIds, setFabricIds] = useState<string[]>([]);
  const [batches, setBatches] = useState<ExperimentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const selectedBatch =
    batches.find((batch) => batch.id === selectedBatchId) ?? batches[0];
  const signature = JSON.stringify({
    mode,
    sourceAssetId,
    prompt,
    preserve,
    colorText,
    variations,
    fabricIds,
  });
  const [baseline, setBaseline] = useState(signature);
  useEffect(() => {
    onDirty?.(signature !== baseline);
    return () => onDirty?.(false);
  }, [signature, baseline, onDirty]);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const active = useRef(true);
  const scope = useRef(base);
  const refresh = useCallback(async () => {
    const records = await request<ExperimentView[]>(base);
    if (active.current && scope.current === base) setBatches(records);
    return records;
  }, [base]);
  useEffect(() => {
    active.current = true;
    scope.current = base;
    let disposed = false;
    void Promise.all([
      refresh(),
      request<{ items: FabricOption[] }>("/api/fabrics?limit=100"),
    ])
      .then(
        ([, result]) => {
          if (!disposed && active.current && scope.current === base) {
            setFabrics(result.items);
            setError(null);
          }
        },
        (cause: unknown) => {
          if (!disposed && active.current && scope.current === base)
            setError(cause instanceof Error ? cause.message : "实验读取失败");
        },
      )
      .finally(() => {
        if (!disposed && active.current && scope.current === base)
          setLoading(false);
      });
    return () => {
      disposed = true;
      active.current = false;
    };
  }, [base, refresh]);
  const hasActive = batches.some((batch) =>
    batch.items.some((item) =>
      ["queued", "running", "dispatching"].includes(item.status),
    ),
  );
  useEffect(() => {
    if (!hasActive) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch (cause) {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : "更新失败");
      }
      if (!disposed)
        timer = setTimeout(() => {
          void poll();
        }, 5000);
    };
    timer = setTimeout(() => {
      void poll();
    }, 5000);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [hasActive, refresh]);
  const makeDraft = async () => {
    setError(null);
    setNotice(null);
    const colors =
      mode === "color" || mode === "material"
        ? colorText
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => ({
              name: line.replace(/#[0-9a-fA-F]{6}/, " ").trim() || "配色",
              hex: line.match(/#[0-9a-fA-F]{6}/)?.[0] ?? "",
            }))
        : [];
    const parsed = experimentCreateSchema.safeParse({
      sourceAssetId,
      mode,
      prompt,
      preserve,
      colors,
      fabricIds: mode === "material" ? fabricIds : [],
      variations:
        mode === "detail" || mode === "presentation"
          ? variations
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
          : [],
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查输入");
      return;
    }
    const body = JSON.stringify(parsed.data);
    if (pending.current?.body !== body)
      pending.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    try {
      const created = await request<ExperimentView>(
        base,
        parsed.data,
        pending.current?.key ?? crypto.randomUUID(),
      );
      pending.current = null;
      setBaseline(signature);
      setSelectedBatchId(created.id);
      onDirty?.(false);
      setBatches((current) => [
        created,
        ...current.filter((batch) => batch.id !== created.id),
      ]);
      setNotice(
        "实验计划已保存。核对单元格后，选择“提交待执行方案”才会生成图片。",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "计划保存失败");
    } finally {
      setBusy(false);
    }
  };
  const act = async (
    batch: ExperimentView,
    action: "submit" | "retry" | "cancel",
    selectedIds?: readonly string[],
  ) => {
    const states =
      action === "submit"
        ? ["draft"]
        : action === "retry"
          ? ["failed", "not_admitted"]
          : ["draft", "dispatching", "queued", "running"];
    const itemIds = batch.items
      .filter(
        (item) =>
          states.includes(item.status) &&
          (!selectedIds || selectedIds.includes(item.id)),
      )
      .map((item) => item.id);
    if (!itemIds.length) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await request<ExperimentView>(
        base + "/" + encodeURIComponent(batch.id) + "/actions",
        {
          itemIds,
          action,
        },
      );
      if (action !== "cancel") {
        for (const item of updated.items) {
          if (itemIds.includes(item.id))
            markMotion(
              `task:${projectId}:${item.id}:${item.attempt}`,
              "needle",
            );
        }
      }
      setBatches((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      onRefresh?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="设计实验室" className={styles.panel}>
      <StudioPageHeader
        title="色料与改款实验"
        description="先保存实验计划，核对后再提交生成"
        actions={
          styleRecords.length ? (
            <span>{styleRecords.length} 个款式可继续发展</span>
          ) : null
        }
      />
      <div className={styles.workspace}>
        <nav className={styles.sectionLinks} aria-label="实验区域">
          <a href={`#${surfaceId}-results`}>查看结果</a>
          <a href={`#${surfaceId}-settings`}>调整设置</a>
        </nav>
        <div id={`${surfaceId}-settings`} className={styles.configuration}>
          {!canEdit ? (
            <p role="status">当前角色可查看实验结果，提交生成需要编辑权限。</p>
          ) : (
            <form
              className={styles.configurationForm}
              onSubmit={(event) => {
                event.preventDefault();
                void makeDraft();
              }}
            >
              <StudioEditSection
                persistent
                title="设置下一轮实验"
                summary={
                  signature !== baseline
                    ? "计划有未保存的修改"
                    : "修改要求、配色与面料"
                }
                save={false}
                error={error}
              >
                <div className={styles.configurationFields}>
                  <fieldset className={styles.form} disabled={busy || loading}>
                    <label>
                      实验类型
                      <Select
                        value={mode}
                        onChange={(event) => {
                          const value = event.target
                            .value as ExperimentCreateInput["mode"];
                          setMode(value);
                          if (value === "presentation")
                            setVariations(
                              "白色背景，服装平铺商品摄影\n简洁室内陈列场景，保持服装细节",
                            );
                          if (value === "detail")
                            setVariations("修改为立领\n修改为翻领");
                        }}
                      >
                        <option value="color">批量配色</option>
                        <option value="material">配色与面料组合</option>
                        <option value="detail">领型、袖型与细节改款</option>
                        <option value="presentation">商品展示素材</option>
                      </Select>
                    </label>
                    <label>
                      母图
                      <Select
                        required
                        value={sourceAssetId}
                        onChange={(event) => setSource(event.target.value)}
                      >
                        <option value="">选择项目中的真实图片</option>
                        {assets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {assetName(asset.id)}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className={styles.wide}>
                      本轮目标
                      <Textarea
                        required
                        value={prompt}
                        maxLength={2000}
                        onChange={(event) => setPrompt(event.target.value)}
                      />
                    </label>
                    <label className={styles.wide}>
                      明确保留的内容
                      <Textarea
                        required
                        value={preserve}
                        maxLength={1000}
                        onChange={(event) => setPreserve(event.target.value)}
                      />
                    </label>
                    {mode === "color" || mode === "material" ? (
                      <label>
                        配色，每行“名称 #HEX”
                        <Textarea
                          value={colorText}
                          onChange={(event) => setColorText(event.target.value)}
                          rows={4}
                        />
                        <small>最多6色；视觉色值需要结合实物和色样复核。</small>
                      </label>
                    ) : (
                      <label className={styles.wide}>
                        修改方案，每行一种
                        <Textarea
                          value={variations}
                          onChange={(event) =>
                            setVariations(event.target.value)
                          }
                          rows={4}
                        />
                        <small>
                          最多6个具体方案；展示图用于视觉表达，不能验证合体性。
                        </small>
                      </label>
                    )}
                    {mode === "material" ? (
                      <fieldset>
                        <legend>面料参考，最多4种</legend>
                        <div className={styles.fabrics}>
                          {fabrics.map((fabric) => (
                            <label key={fabric.id}>
                              <input
                                type="checkbox"
                                checked={fabricIds.includes(fabric.id)}
                                onChange={(event) =>
                                  setFabricIds((current) =>
                                    event.target.checked
                                      ? [...current, fabric.id]
                                      : current.filter(
                                          (id) => id !== fabric.id,
                                        ),
                                  )
                                }
                              />
                              <span>
                                {fabric.details?.name ||
                                  fabric.tags.join(" / ") ||
                                  "未命名面料"}
                              </span>
                            </label>
                          ))}
                        </div>
                        {!fabrics.length ? (
                          <p>先在面料库上传小样和规格。</p>
                        ) : null}
                      </fieldset>
                    ) : null}
                    <p className={styles.wide}>
                      每批最多12个组合；每项一个生成任务，按现有成功任务规则计次。提交时逐项接纳，额度不足项会保留为未接纳。精确局部换料尚未开放，材质实验会影响整张图。
                    </p>
                  </fieldset>
                </div>
                <div className={styles.configurationActions}>
                  <Button
                    type="submit"
                    variant={
                      signature !== baseline ||
                      !selectedBatch?.items.some(
                        (item) => item.status === "draft",
                      )
                        ? "primary"
                        : "secondary"
                    }
                    loading={busy}
                    disabled={!assets.length}
                  >
                    保存实验计划
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setError(null);
                      void refresh().catch((cause) =>
                        setError(
                          cause instanceof Error ? cause.message : "更新失败",
                        ),
                      );
                    }}
                  >
                    刷新结果
                  </Button>
                </div>
              </StudioEditSection>
            </form>
          )}
        </div>
        <div
          id={`${surfaceId}-results`}
          className={styles.results}
          aria-label="实验计划与结果"
        >
          {batches.length > 1 ? (
            <label className={styles.batchSelector}>
              当前实验批次
              <Select
                value={selectedBatch?.id ?? ""}
                onChange={(event) => setSelectedBatchId(event.target.value)}
              >
                {batches.map((batch, index) => (
                  <option value={batch.id} key={batch.id}>
                    实验 {batches.length - index} · {batch.items.length} 个方案
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {userFacingError(error, "实验暂时无法完成，请重试")}
            </p>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
          {loading ? (
            <div className={styles.skeleton} role="status">
              正在读取实验计划…
            </div>
          ) : !batches.length ? (
            <div className={styles.sourceStart}>
              <h3>本轮母图</h3>
              {assets.find((asset) => asset.id === sourceAssetId) ? (
                <ImagePreview
                  src={assets.find((asset) => asset.id === sourceAssetId)?.url}
                  alt="本轮实验母图"
                />
              ) : (
                <p>从项目图片中选择母图，再设置修改目标。</p>
              )}
              <p>
                从一张图片开始，保存第一组配色或面料实验。结果将在这里与母图对照。
              </p>
            </div>
          ) : null}
          {batches
            .filter((batch) => batch.id === selectedBatch?.id)
            .map((batch) => (
              <section
                key={batch.id}
                className={styles.batch}
                aria-label={"实验 " + batch.id.slice(-6)}
              >
                <div className={styles.batchHeading}>
                  <div>
                    <h3>
                      {batch.mode === "presentation"
                        ? "展示素材"
                        : batch.mode === "detail"
                          ? "细节改款"
                          : "色料实验"}{" "}
                      · {batch.items.length} 个方案
                    </h3>
                    <small>保留要求：{batch.preserve}</small>
                  </div>
                  {canEdit ? (
                    <div className={styles.actions}>
                      <Button
                        variant={
                          signature === baseline ? "primary" : "secondary"
                        }
                        loading={busy}
                        disabled={
                          !batch.items.some((item) => item.status === "draft")
                        }
                        onClick={() => void act(batch, "submit")}
                      >
                        提交待执行方案
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          !batch.items.some((item) =>
                            ["failed", "not_admitted"].includes(item.status),
                          )
                        }
                        onClick={() => void act(batch, "retry")}
                      >
                        仅重试失败项
                      </Button>
                      <Button
                        disabled={
                          busy ||
                          !batch.items.some((item) =>
                            [
                              "draft",
                              "queued",
                              "running",
                              "dispatching",
                            ].includes(item.status),
                          )
                        }
                        onClick={() => void act(batch, "cancel")}
                      >
                        取消待完成项
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className={styles.resultFilters} aria-label="实验状态筛选">
                  {[
                    ["all", "全部"],
                    ["active", "待完成"],
                    ["succeeded", "已完成"],
                    ["failed", "失败或未接纳"],
                    ["canceled", "已取消"],
                  ].map(([value, label]) => (
                    <Button
                      size="small"
                      key={value}
                      aria-pressed={resultFilter === value}
                      onClick={() => setResultFilter(value ?? "all")}
                    >
                      {label} ·{" "}
                      {
                        batch.items.filter(
                          (item) =>
                            value === "all" ||
                            (value === "active"
                              ? [
                                  "draft",
                                  "queued",
                                  "dispatching",
                                  "running",
                                ].includes(item.status)
                              : value === "failed"
                                ? ["failed", "not_admitted"].includes(
                                    item.status,
                                  )
                                : item.status === value),
                        ).length
                      }
                    </Button>
                  ))}
                </div>
                {!batch.items.some((item) => matchesResult(item.status)) ? (
                  <p role="status">当前筛选下没有方案。原款仍保留用于对照。</p>
                ) : null}
                <div className={styles.matrix}>
                  <article className={styles.sourceItem}>
                    <div className={styles.preview}>
                      <ImagePreview
                        src={
                          assets.find(
                            (asset) => asset.id === batch.sourceAssetId,
                          )?.url
                        }
                        alt="本轮实验母图"
                      />
                    </div>
                    <div className={styles.itemBody}>
                      <h4>原款</h4>
                      <span className={styles.state}>本轮比较基准</span>
                    </div>
                  </article>
                  {batch.items
                    .filter((item) => matchesResult(item.status))
                    .map((item) => (
                      <article
                        key={item.id}
                        className={styles.item}
                        data-status={item.status}
                      >
                        <div className={styles.preview}>
                          {item.assets[0] ? (
                            <ImagePreview
                              src={
                                item.assets[0].thumbnailUrl ??
                                item.assets[0].url
                              }
                              alt={item.title}
                            />
                          ) : viewingItemId === item.id &&
                            isTaskActive(item.status) ? (
                            <TaskFeedback
                              taskId={`${projectId}:${item.id}:${item.attempt}`}
                              status={item.status}
                              compact
                              operation={
                                batch.mode === "material"
                                  ? "material"
                                  : batch.mode === "color"
                                    ? "color"
                                    : "edit"
                              }
                            />
                          ) : (
                            <span>{stateLabel[item.status]}</span>
                          )}
                        </div>
                        <div className={styles.itemBody}>
                          <Badge
                            tone={
                              item.status === "succeeded"
                                ? "success"
                                : ["failed", "not_admitted"].includes(
                                      item.status,
                                    )
                                  ? "error"
                                  : isTaskActive(item.status)
                                    ? "running"
                                    : "neutral"
                            }
                          >
                            {stateLabel[item.status]}
                            {item.attempt ? " · 重试 " + item.attempt : ""}
                          </Badge>
                          <h4>{item.title}</h4>
                          {item.color ? (
                            <span className={styles.color}>
                              <i style={{ background: item.color.hex }} />
                              {item.color.hex}
                            </span>
                          ) : null}
                          {item.error ? (
                            <p role="status">
                              {userFacingError(
                                item.error,
                                "此方案未完成，可重试失败项",
                              )}
                            </p>
                          ) : null}
                          {canEdit &&
                          ["failed", "not_admitted"].includes(item.status) ? (
                            <Button
                              disabled={busy}
                              onClick={() =>
                                void act(batch, "retry", [item.id])
                              }
                            >
                              重试此方案
                            </Button>
                          ) : null}
                          {isTaskActive(item.status) ? (
                            <Button
                              size="small"
                              aria-pressed={viewingItemId === item.id}
                              onClick={() =>
                                setViewingItemId(
                                  viewingItemId === item.id ? null : item.id,
                                )
                              }
                            >
                              {viewingItemId === item.id
                                ? "收起生成状态"
                                : "查看生成状态"}
                            </Button>
                          ) : null}
                          <details>
                            <summary>修改要求与来源</summary>
                            <p>{item.prompt}</p>
                            <small>母图：{batch.sourceAssetId}</small>
                            {item.fabric ? (
                              <p>面料快照：{item.fabric.tags.join(" / ")}</p>
                            ) : null}
                          </details>
                          {item.assets.map((asset) => (
                            <a
                              key={asset.id}
                              href={
                                "/" +
                                encodeURIComponent(projectId) +
                                "/studio?tab=styles&assetId=" +
                                encodeURIComponent(asset.id)
                              }
                            >
                              比较并保存为款式
                            </a>
                          ))}
                        </div>
                      </article>
                    ))}
                </div>
              </section>
            ))}
        </div>
      </div>
    </section>
  );
}
