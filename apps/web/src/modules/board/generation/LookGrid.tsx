"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  createCollectionLook,
  forceKeepCollectionLook,
} from "./collection-api";
import type {
  CollectionConsistency,
  CollectionDna,
  GarmentType,
  CollectionVariationAxis,
} from "./collection-types";
import { GARMENT_TYPE_OPTIONS } from "./collection-types";
import { fetchGenerationTask } from "./generation-api";
import styles from "./generation.module.css";
import { VariationAxisSelector } from "./VariationAxisSelector";
import { captureAnalytics } from "../../../observability/analytics";

const TASK_POLL_MS = 1_200;
const ANALYSIS_POLL_MS = 1_500;
const MAX_TASK_POLLS = 300;
const MAX_ANALYSIS_POLLS = 80;
const DEFAULT_SERIES_COUNT = 8;
const MAX_SERIES_COUNT = 12;
const MAX_GENERATION_PROMPT_LENGTH = 800;
const SERIES_PLAN_STORAGE_PREFIX = "fashion:series-plan:v1:";
const DEFAULT_GARMENT_TYPE: GarmentType = { code: "top", label: "上装" };

type ExpansionMode = "plan" | "single";
type SlotStatus = "failed" | "idle" | "running";

interface SeriesPlanSlot {
  readonly key: string;
  readonly name: string;
  readonly garmentType: GarmentType;
  readonly direction: string;
}

interface SeriesPlanDraft {
  readonly ownerKey: string;
  readonly sourceSignature: string;
  readonly brief: string;
  readonly slots: readonly SeriesPlanSlot[];
}

type SeriesCategory = "bottom" | "custom" | "onePiece" | "outerwear" | "top";

interface SeriesBalanceAnalysis {
  readonly breakdown: readonly {
    readonly category: SeriesCategory;
    readonly count: number;
    readonly label: string;
    readonly percentage: number;
  }[];
  readonly total: number;
  readonly warnings: readonly string[];
}

export function LookGrid({
  beforeGenerate,
  collectionId,
  consistency,
  dna,
  sourceGarmentType,
  onRefresh,
}: {
  readonly beforeGenerate: () => Promise<void>;
  readonly collectionId: string;
  readonly consistency: CollectionConsistency;
  readonly dna: CollectionDna;
  readonly sourceGarmentType: GarmentType | null;
  readonly onRefresh: () => Promise<CollectionConsistency>;
}) {
  const [mode, setMode] = useState<ExpansionMode>("plan");
  const [axis, setAxis] = useState<CollectionVariationAxis>(() =>
    firstAvailableAxis(dna),
  );
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planDraft, setPlanDraft] = useState<SeriesPlanDraft>(() =>
    loadSeriesPlanDraft(collectionId, sourceGarmentType),
  );
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<ReadonlySet<string>>(
    () => new Set(planDraft.slots.map((slot) => slot.key)),
  );
  const [slotStatus, setSlotStatus] = useState<Record<string, SlotStatus>>({});
  const sourceTypeSignature = `${sourceGarmentType?.code ?? ""}:${sourceGarmentType?.label ?? ""}`;
  const planOwnerKey = `${collectionId}:${sourceTypeSignature}`;
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  if (
    planDraft.ownerKey !== collectionId ||
    planDraft.sourceSignature !== sourceTypeSignature
  ) {
    const nextDraft = loadSeriesPlanDraft(collectionId, sourceGarmentType);
    setPlanDraft(nextDraft);
    setSelectedSlotKeys(new Set(nextDraft.slots.map((slot) => slot.key)));
    setSlotStatus({});
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (
      planDraft.ownerKey === collectionId &&
      `${planDraft.ownerKey}:${planDraft.sourceSignature}` === planOwnerKey
    ) {
      persistSeriesPlanDraft(planDraft);
    }
  }, [collectionId, planDraft, planOwnerKey]);

  const slots = planDraft.slots;
  const targetCount = slots.length + 1;

  const effectiveAxis = axisLocked(axis, dna) ? firstAvailableAxis(dna) : axis;

  const completedSlotKeys = useMemo(
    () =>
      new Set(
        consistency.looks.flatMap((look) =>
          look.slotKey ? [look.slotKey] : [],
        ),
      ),
    [consistency.looks],
  );

  const highSimilarity = useMemo(() => {
    const messages = new Map<string, string[]>();
    for (const pair of consistency.similarities) {
      if (pair.score <= 0.95) continue;
      const left = consistency.looks.find(
        (look) => look.assetId === pair.leftAssetId,
      );
      const right = consistency.looks.find(
        (look) => look.assetId === pair.rightAssetId,
      );
      if (!left || !right) continue;
      appendMessage(messages, left.assetId, `与 Look${right.ordinal} 高度相似`);
      appendMessage(messages, right.assetId, `与 Look${left.ordinal} 高度相似`);
    }
    return messages;
  }, [consistency]);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const previousLookCount = consistency.looks.length;
    try {
      await beforeGenerate();
      const taskId = await createCollectionLook(
        collectionId,
        effectiveAxis,
        direction,
      );
      await waitForGeneration(taskId);
      captureAnalytics("collection_look_generated", {
        variation_axis: effectiveAxis,
      });
      if (!mounted.current) return;
      setDirection("");
      await waitForSimilarity(onRefresh, previousLookCount);
    } catch (reason) {
      let completedAfterTimeout = false;
      try {
        const refreshed = await onRefresh();
        completedAfterTimeout = refreshed.looks.length > previousLookCount;
      } catch {
        // Preserve the original task error when the recovery refresh also fails.
      }
      if (mounted.current) {
        if (completedAfterTimeout) {
          setDirection("");
        } else {
          setError(
            reason instanceof Error ? reason.message : "系列 Look 生成失败",
          );
        }
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const forceKeep = async (assetId: string): Promise<void> => {
    setError(null);
    try {
      await forceKeepCollectionLook(collectionId, assetId);
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "强制保留 Look 失败");
    }
  };

  const generateSlot = async (
    slot: SeriesPlanSlot,
    refreshAfter = true,
  ): Promise<CollectionConsistency | null> => {
    setSlotStatus((current) => ({ ...current, [slot.key]: "running" }));
    try {
      await beforeGenerate();
      const taskId = await createCollectionLook(
        collectionId,
        "garmentType",
        compileSeriesSlotPrompt(planDraft.brief, slot.direction),
        slot.garmentType,
        slot.key,
      );
      await waitForGeneration(taskId);
      captureAnalytics("collection_look_generated", {
        garment_type: slot.garmentType.code,
        variation_axis: "garmentType",
      });
      const refreshed = refreshAfter
        ? await waitForSimilarity(onRefresh, consistency.looks.length)
        : null;
      setSlotStatus((current) => ({ ...current, [slot.key]: "idle" }));
      return refreshed;
    } catch (reason) {
      setSlotStatus((current) => ({ ...current, [slot.key]: "failed" }));
      throw reason;
    }
  };

  const generateNextSlot = async (): Promise<void> => {
    if (planBusy) return;
    const next = slots.find((slot) => !completedSlotKeys.has(slot.key));
    if (!next) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      await generateSlot(next);
      setSelectedSlotKeys((current) => withoutKey(current, next.key));
    } catch (reason) {
      setPlanError(
        reason instanceof Error ? reason.message : "系列款式生成失败",
      );
    } finally {
      setPlanBusy(false);
    }
  };

  const runSingleSlot = async (slot: SeriesPlanSlot): Promise<void> => {
    if (planBusy) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      await generateSlot(slot);
      setSelectedSlotKeys((current) => withoutKey(current, slot.key));
    } catch (reason) {
      setPlanError(
        reason instanceof Error ? reason.message : "系列款式生成失败",
      );
    } finally {
      setPlanBusy(false);
    }
  };

  const updateSlot = (
    key: string,
    update: Partial<Omit<SeriesPlanSlot, "key">>,
  ): void => {
    setPlanDraft((current) => ({
      ...current,
      slots: current.slots.map((slot) =>
        slot.key === key ? { ...slot, ...update } : slot,
      ),
    }));
  };

  const changeTargetCount = (count: number): void => {
    const nextSlots = resizeSeriesSlots(
      slots,
      count,
      sourceGarmentType,
      completedSlotKeys,
    );
    setPlanDraft((current) => ({ ...current, slots: nextSlots }));
    setSelectedSlotKeys((current) =>
      reconcileSelection(current, slots, nextSlots, completedSlotKeys),
    );
  };

  const addSlot = (): void => {
    if (slots.length >= MAX_SERIES_COUNT - 1) return;
    const nextSlots = appendRecommendedSlot(slots, sourceGarmentType);
    const added = nextSlots.at(-1);
    setPlanDraft((current) => ({ ...current, slots: nextSlots }));
    if (added) {
      setSelectedSlotKeys((current) => new Set([...current, added.key]));
    }
  };

  const removeSlot = (key: string): void => {
    if (slots.length <= 1 || completedSlotKeys.has(key)) return;
    setPlanDraft((current) => ({
      ...current,
      slots: current.slots.filter((slot) => slot.key !== key),
    }));
    setSelectedSlotKeys((current) => withoutKey(current, key));
  };

  const duplicateSlot = (slot: SeriesPlanSlot): void => {
    if (slots.length >= MAX_SERIES_COUNT - 1) return;
    const duplicate = {
      ...slot,
      key: nextSeriesSlotKey(slots),
      name: `${slot.name} 副本`.slice(0, 40),
    };
    setPlanDraft((current) => ({
      ...current,
      slots: [...current.slots, duplicate],
    }));
    setSelectedSlotKeys((current) => new Set([...current, duplicate.key]));
  };

  const moveSlot = (key: string, offset: -1 | 1): void => {
    setPlanDraft((current) => ({
      ...current,
      slots: moveSeriesSlot(current.slots, key, offset, completedSlotKeys),
    }));
  };

  const resetRecommendation = (): void => {
    const recommended = buildSeriesPlan(sourceGarmentType, targetCount);
    const nextSlots = slots.map((slot, index) => {
      if (completedSlotKeys.has(slot.key)) return slot;
      const template = recommended[index] ?? recommended.at(-1);
      return template ? { ...template, key: slot.key } : slot;
    });
    setPlanDraft((current) => ({ ...current, slots: nextSlots }));
    setSelectedSlotKeys(
      new Set(
        nextSlots
          .filter((slot) => !completedSlotKeys.has(slot.key))
          .map((slot) => slot.key),
      ),
    );
    setPlanError(null);
  };

  const generateSelectedSlots = async (): Promise<void> => {
    if (planBusy) return;
    const selectedSlots = slots.filter(
      (slot) =>
        selectedSlotKeys.has(slot.key) && !completedSlotKeys.has(slot.key),
    );
    if (selectedSlots.length === 0) return;
    setPlanBusy(true);
    setPlanError(null);
    try {
      const generatedKeys = new Set(completedSlotKeys);
      const errors = await runSeriesPlan(
        selectedSlots,
        generatedKeys,
        async (slot) => {
          const refreshed = await generateSlot(slot);
          if (refreshed?.looks.some((look) => look.slotKey === slot.key)) {
            generatedKeys.add(slot.key);
            setSelectedSlotKeys((current) => withoutKey(current, slot.key));
          }
        },
      );
      if (errors.length > 0) {
        setPlanError(`部分槽位未完成：${errors.join("；")}`);
      }
    } finally {
      setPlanBusy(false);
    }
  };

  return (
    <section className={styles.lookLab}>
      <header>
        <div>
          <span>COLLECTION EXPANSION</span>
          <h2>扩展新 Look</h2>
        </div>
        <strong>{consistency.looks.length} LOOKS</strong>
      </header>

      <nav aria-label="系列扩展模式" className={styles.expansionMode}>
        <button
          aria-pressed={mode === "plan"}
          onClick={() => setMode("plan")}
          type="button"
        >
          系列计划
        </button>
        <button
          aria-pressed={mode === "single"}
          onClick={() => setMode("single")}
          type="button"
        >
          单 Look 扩展
        </button>
      </nav>

      {mode === "single" ? (
        <>
          <VariationAxisSelector
            disabled={busy}
            dna={dna}
            onChange={setAxis}
            value={effectiveAxis}
          />

          <label className={styles.lookDirection}>
            <span>可选补充方向</span>
            <textarea
              disabled={busy}
              maxLength={800}
              onChange={(event) => setDirection(event.target.value)}
              placeholder="例如：增加轻量叠穿，但保留克制的正面结构"
              rows={3}
              value={direction}
            />
          </label>

          <button
            className={styles.generateLookButton}
            disabled={busy}
            onClick={() => void generate()}
            type="button"
          >
            {busy
              ? "生成与计算参考相似度中…"
              : `沿「${axisLabel(effectiveAxis)}」扩展 Look`}
          </button>
          {error ? (
            <p className={styles.lookError} role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <SeriesPlanEditor
          busy={planBusy}
          brief={planDraft.brief}
          completedSlotKeys={completedSlotKeys}
          onAddSlot={addSlot}
          onBriefChange={(brief) =>
            setPlanDraft((current) => ({ ...current, brief }))
          }
          onCountChange={changeTargetCount}
          onDeleteSlot={removeSlot}
          onDuplicateSlot={duplicateSlot}
          onGenerateNext={() => void generateNextSlot()}
          onGenerateSelected={() => void generateSelectedSlots()}
          onGenerateSlot={(slot) => void runSingleSlot(slot)}
          onMoveSlot={moveSlot}
          onResetRecommendation={resetRecommendation}
          onSelectionChange={setSelectedSlotKeys}
          onUpdateSlot={updateSlot}
          selectedSlotKeys={selectedSlotKeys}
          slots={slots}
          slotStatus={slotStatus}
          sourceGarmentType={sourceGarmentType}
          targetCount={targetCount}
        />
      )}

      {planError && mode === "plan" ? (
        <p className={styles.lookError} role="alert">
          {planError}
        </p>
      ) : null}

      <div className={styles.lookGrid}>
        {consistency.looks.map((look) => {
          const drift =
            !look.isHero &&
            look.similarityScore !== null &&
            look.similarityScore < 0.5;
          const messages = highSimilarity.get(look.assetId) ?? [];
          return (
            <article
              data-drift={drift && !look.warningIgnored}
              key={look.assetId}
            >
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={`系列 Look ${look.ordinal}`}
                  src={look.thumbnailUrl ?? look.url}
                />
                <figcaption>
                  <strong>LOOK {look.ordinal}</strong>
                  <span>
                    {look.isHero
                      ? (sourceGarmentType?.label ?? "HERO")
                      : (look.garmentType?.label ??
                        axisLabel(look.variationAxis))}
                  </span>
                </figcaption>
              </figure>
              <div>
                <span>最低参考相似度</span>
                <strong>
                  {look.similarityScore === null
                    ? statusLabel(look.analysisStatus)
                    : look.similarityScore.toFixed(2)}
                </strong>
              </div>
              {messages.map((message) => (
                <p className={styles.duplicateNotice} key={message}>
                  {message}
                </p>
              ))}
              {drift ? (
                <div className={styles.driftNotice}>
                  <strong>偏离系列参考区间</strong>
                  {look.warningIgnored ? (
                    <span>已忽略提示并保留</span>
                  ) : (
                    <button
                      onClick={() => void forceKeep(look.assetId)}
                      type="button"
                    >
                      忽略提示并强制保留
                    </button>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
        {busy ? (
          <article className={styles.lookPending} aria-label="新 Look 生成中">
            <i />
            <strong>NEXT LOOK</strong>
            <span>正在注入锁定 DNA</span>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function SeriesPlanEditor({
  brief,
  busy,
  completedSlotKeys,
  onAddSlot,
  onBriefChange,
  onCountChange,
  onDeleteSlot,
  onDuplicateSlot,
  onGenerateNext,
  onGenerateSelected,
  onGenerateSlot,
  onMoveSlot,
  onResetRecommendation,
  onSelectionChange,
  onUpdateSlot,
  selectedSlotKeys,
  slots,
  slotStatus,
  sourceGarmentType,
  targetCount,
}: {
  readonly brief: string;
  readonly busy: boolean;
  readonly completedSlotKeys: ReadonlySet<string>;
  readonly onAddSlot: () => void;
  readonly onBriefChange: (brief: string) => void;
  readonly onCountChange: (count: number) => void;
  readonly onDeleteSlot: (key: string) => void;
  readonly onDuplicateSlot: (slot: SeriesPlanSlot) => void;
  readonly onGenerateNext: () => void;
  readonly onGenerateSelected: () => void;
  readonly onGenerateSlot: (slot: SeriesPlanSlot) => void;
  readonly onMoveSlot: (key: string, offset: -1 | 1) => void;
  readonly onResetRecommendation: () => void;
  readonly onSelectionChange: (keys: ReadonlySet<string>) => void;
  readonly onUpdateSlot: (
    key: string,
    update: Partial<Omit<SeriesPlanSlot, "key">>,
  ) => void;
  readonly selectedSlotKeys: ReadonlySet<string>;
  readonly slots: readonly SeriesPlanSlot[];
  readonly slotStatus: Readonly<Record<string, SlotStatus>>;
  readonly sourceGarmentType: GarmentType | null;
  readonly targetCount: number;
}) {
  const completedCount = slots.filter((slot) =>
    completedSlotKeys.has(slot.key),
  ).length;
  const pendingSlots = slots.filter((slot) => !completedSlotKeys.has(slot.key));
  const selectedPendingCount = pendingSlots.filter((slot) =>
    selectedSlotKeys.has(slot.key),
  ).length;
  const allCompleted = completedCount === slots.length;
  const hasInvalidSelectedCustom = pendingSlots.some(
    (slot) =>
      selectedSlotKeys.has(slot.key) &&
      slot.garmentType.code === "custom" && !slot.garmentType.label.trim(),
  );
  const nextPending = pendingSlots[0];
  const nextPendingInvalid =
    nextPending?.garmentType.code === "custom" &&
    !nextPending.garmentType.label.trim();
  const allPendingSelected =
    pendingSlots.length > 0 && selectedPendingCount === pendingSlots.length;
  const progress = slots.length === 0 ? 0 : completedCount / slots.length;
  const balance = analyzeSeriesBalance(sourceGarmentType, slots);

  return (
    <section className={styles.seriesPlan}>
      <header>
        <div>
          <span>SERIES PLAN</span>
          <strong>系列开发计划</strong>
          <small>{completedCount} / {slots.length} 扩展款已完成</small>
        </div>
        <label>
          <span>系列款数</span>
          <input
            aria-label="系列款数"
            disabled={busy}
            max={MAX_SERIES_COUNT}
            min={2}
            onChange={(event) =>
              onCountChange(
                Math.min(
                  MAX_SERIES_COUNT,
                  Math.max(2, Number(event.target.value) || 2),
                ),
              )
            }
            type="number"
            value={targetCount}
          />
        </label>
      </header>

      <div
        aria-label={`系列计划进度 ${completedCount}/${slots.length}`}
        className={styles.seriesPlanProgress}
        role="progressbar"
        aria-valuemax={slots.length}
        aria-valuemin={0}
        aria-valuenow={completedCount}
      >
        <i style={{ transform: `scaleX(${progress})` }} />
      </div>

      <label className={styles.seriesBrief}>
        <span>系列开发目标</span>
        <textarea
          disabled={busy}
          maxLength={500}
          onChange={(event) => onBriefChange(event.target.value)}
          placeholder="季节、场景、客群、价格带与上市节奏"
          rows={3}
          value={brief}
        />
        <small>{brief.length} / 500</small>
      </label>

      <section className={styles.seriesBalance} aria-label="品类结构分析">
        <header>
          <div>
            <span>ASSORTMENT BALANCE</span>
            <strong>{balance.total} 款品类结构</strong>
          </div>
          <button
            disabled={busy}
            onClick={onResetRecommendation}
            type="button"
          >
            恢复推荐配比
          </button>
        </header>
        <dl>
          {balance.breakdown.map((item) => (
            <div key={item.category}>
              <dt>{item.label}</dt>
              <dd>
                <strong>{item.count}</strong>
                <span>{item.percentage}%</span>
              </dd>
              <i style={{ transform: `scaleX(${item.percentage / 100})` }} />
            </div>
          ))}
        </dl>
        {balance.warnings.length > 0 ? (
          <ul className={styles.seriesBalanceWarnings}>
            {balance.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.seriesBalanceReady}>品类结构覆盖完整</p>
        )}
      </section>

      <article className={styles.seriesHeroSlot}>
        <div>
          <span>LOOK 01</span>
          <strong>{sourceGarmentType?.label ?? "核心 Hero"}</strong>
        </div>
        <small>系列原点</small>
      </article>

      <div className={styles.seriesPlanToolbar}>
        <label>
          <input
            checked={allPendingSelected}
            disabled={busy || pendingSlots.length === 0}
            onChange={(event) =>
              onSelectionChange(
                event.target.checked
                  ? new Set(pendingSlots.map((slot) => slot.key))
                  : new Set(),
              )
            }
            type="checkbox"
          />
          <span>选择全部待生成款</span>
        </label>
        <button
          disabled={busy || slots.length >= MAX_SERIES_COUNT - 1}
          onClick={onAddSlot}
          type="button"
        >
          添加槽位
        </button>
      </div>

      <div className={styles.seriesSlotList}>
        {slots.map((slot, index) => {
          const completed = completedSlotKeys.has(slot.key);
          const status = completed
            ? "completed"
            : (slotStatus[slot.key] ?? "idle");
          return (
            <article data-status={status} key={slot.key}>
              <header>
                <label className={styles.seriesSlotSelect}>
                  <input
                    aria-label={`选择 ${slot.name}`}
                    checked={!completed && selectedSlotKeys.has(slot.key)}
                    disabled={busy || completed}
                    onChange={(event) => {
                      const next = new Set(selectedSlotKeys);
                      if (event.target.checked) next.add(slot.key);
                      else next.delete(slot.key);
                      onSelectionChange(next);
                    }}
                    type="checkbox"
                  />
                  <span>LOOK {String(index + 2).padStart(2, "0")}</span>
                </label>
                <div>
                  <strong>{slot.name}</strong>
                  <small>{slotStatusLabel(status)}</small>
                </div>
                <div className={styles.seriesSlotActions}>
                  <button
                    aria-label={`上移 ${slot.name}`}
                    disabled={
                      busy ||
                      completed ||
                      index === 0 ||
                      completedSlotKeys.has(slots[index - 1]?.key ?? "")
                    }
                    onClick={() => onMoveSlot(slot.key, -1)}
                    title="上移"
                    type="button"
                  >
                    上移
                  </button>
                  <button
                    aria-label={`下移 ${slot.name}`}
                    disabled={
                      busy ||
                      completed ||
                      index === slots.length - 1 ||
                      completedSlotKeys.has(slots[index + 1]?.key ?? "")
                    }
                    onClick={() => onMoveSlot(slot.key, 1)}
                    title="下移"
                    type="button"
                  >
                    下移
                  </button>
                  <button
                    aria-label={`复制 ${slot.name}`}
                    disabled={busy || slots.length >= MAX_SERIES_COUNT - 1}
                    onClick={() => onDuplicateSlot(slot)}
                    title="复制槽位"
                    type="button"
                  >
                    复制
                  </button>
                  <button
                    aria-label={`删除 ${slot.name}`}
                    disabled={busy || completed || slots.length <= 1}
                    onClick={() => onDeleteSlot(slot.key)}
                    title="删除槽位"
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </header>
              <div className={styles.seriesSlotFields}>
                <label>
                  <span>槽位名称</span>
                  <input
                    disabled={busy || completed}
                    maxLength={40}
                    onChange={(event) =>
                      onUpdateSlot(slot.key, { name: event.target.value })
                    }
                    value={slot.name}
                  />
                </label>
                <label>
                  <span>服装类型</span>
                  <select
                    disabled={busy || completed}
                    onChange={(event) => {
                      const selected = GARMENT_TYPE_OPTIONS.find(
                        (option) => option.code === event.target.value,
                      );
                      if (selected) {
                        onUpdateSlot(slot.key, {
                          garmentType:
                            selected.code === "custom"
                              ? { code: "custom", label: "" }
                              : selected,
                        });
                      }
                    }}
                    value={slot.garmentType.code}
                  >
                    {GARMENT_TYPE_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {slot.garmentType.code === "custom" ? (
                  <label>
                    <span>自定义类型</span>
                    <input
                      disabled={busy || completed}
                      maxLength={64}
                      onChange={(event) =>
                        onUpdateSlot(slot.key, {
                          garmentType: {
                            code: "custom",
                            label: event.target.value,
                          },
                        })
                      }
                      placeholder="输入服装类型"
                      value={
                        slot.garmentType.label === "自定义类型"
                          ? ""
                          : slot.garmentType.label
                      }
                    />
                  </label>
                ) : null}
                <label className={styles.seriesSlotDirection}>
                  <span>设计方向</span>
                  <textarea
                    disabled={busy || completed}
                    maxLength={800}
                    onChange={(event) =>
                      onUpdateSlot(slot.key, { direction: event.target.value })
                    }
                    rows={2}
                    value={slot.direction}
                  />
                </label>
              </div>
              <button
                disabled={
                  busy ||
                  completed ||
                  (slot.garmentType.code === "custom" &&
                    !slot.garmentType.label.trim())
                }
                onClick={() => onGenerateSlot(slot)}
                type="button"
              >
                {status === "failed" ? "重试此款" : "生成此款"}
              </button>
            </article>
          );
        })}
      </div>

      <footer>
        <div>
          <strong>{selectedPendingCount} 款已加入生成队列</strong>
          <span>按计划顺序逐款生成</span>
        </div>
        <button
          disabled={busy || allCompleted || nextPendingInvalid}
          onClick={onGenerateNext}
          type="button"
        >
          生成下一款
        </button>
        <button
          disabled={
            busy ||
            selectedPendingCount === 0 ||
            hasInvalidSelectedCustom
          }
          onClick={onGenerateSelected}
          type="button"
        >
          {busy ? "系列生成中…" : `生成选中 ${selectedPendingCount} 款`}
        </button>
      </footer>
    </section>
  );
}

export function buildSeriesPlan(
  source: GarmentType | null,
  targetCount: number,
): SeriesPlanSlot[] {
  const recommendationCodes = recommendedGarmentCodes(source?.code);
  return Array.from({ length: targetCount - 1 }, (_, index) => {
    const code =
      recommendationCodes[index % recommendationCodes.length] ?? "top";
    const garmentType =
      GARMENT_TYPE_OPTIONS.find((option) => option.code === code) ??
      DEFAULT_GARMENT_TYPE;
    return {
      direction: `将核心款的系列 DNA 转译到${garmentType.label}，根据目标品类重组结构与比例。`,
      garmentType,
      key: `slot-${String(index + 2).padStart(2, "0")}`,
      name: `${garmentType.label} ${String(index + 1).padStart(2, "0")}`,
    };
  });
}

export function createInitialSeriesPlanDraft(
  collectionId: string,
  source: GarmentType | null,
): SeriesPlanDraft {
  return {
    brief: "",
    ownerKey: collectionId,
    slots: buildSeriesPlan(source, DEFAULT_SERIES_COUNT),
    sourceSignature: garmentTypeSignature(source),
  };
}

export function parsePersistedSeriesPlan(
  raw: string,
  collectionId: string,
  source: GarmentType | null,
): SeriesPlanDraft | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    if (
      value.ownerKey !== collectionId ||
      value.sourceSignature !== garmentTypeSignature(source) ||
      typeof value.brief !== "string" ||
      value.brief.length > 500 ||
      !Array.isArray(value.slots) ||
      value.slots.length < 1 ||
      value.slots.length > MAX_SERIES_COUNT - 1
    ) {
      return null;
    }

    const slots = value.slots.map(parseSeriesPlanSlot);
    if (slots.some((slot) => slot === null)) return null;
    const validSlots = slots.filter((slot): slot is SeriesPlanSlot => slot !== null);
    if (new Set(validSlots.map((slot) => slot.key)).size !== validSlots.length) {
      return null;
    }

    return {
      brief: value.brief,
      ownerKey: collectionId,
      slots: validSlots,
      sourceSignature: garmentTypeSignature(source),
    };
  } catch {
    return null;
  }
}

export function compileSeriesSlotPrompt(
  brief: string,
  direction: string,
): string {
  const sections = [
    brief.trim() ? `系列开发目标：${brief.trim()}` : "",
    direction.trim() ? `当前槽位设计方向：${direction.trim()}` : "",
  ].filter(Boolean);
  return sections.join("\n").slice(0, MAX_GENERATION_PROMPT_LENGTH);
}

export function analyzeSeriesBalance(
  source: GarmentType | null,
  slots: readonly SeriesPlanSlot[],
): SeriesBalanceAnalysis {
  const categories: readonly {
    readonly category: SeriesCategory;
    readonly label: string;
  }[] = [
    { category: "outerwear", label: "外套" },
    { category: "top", label: "上装" },
    { category: "bottom", label: "下装" },
    { category: "onePiece", label: "连身款" },
    { category: "custom", label: "自定义" },
  ];
  const garmentTypes = [
    ...(source ? [source] : []),
    ...slots.map((slot) => slot.garmentType),
  ];
  const total = garmentTypes.length;
  const breakdown = categories.map(({ category, label }) => {
    const count = garmentTypes.filter(
      (garmentType) => seriesCategory(garmentType.code) === category,
    ).length;
    return {
      category,
      count,
      label,
      percentage: total === 0 ? 0 : Math.round((count / total) * 100),
    };
  });
  const warnings: string[] = [];
  const countFor = (category: SeriesCategory): number =>
    breakdown.find((item) => item.category === category)?.count ?? 0;

  if (total >= 4) {
    if (countFor("bottom") === 0) warnings.push("缺少下装，系列搭配链路不完整");
    if (countFor("top") === 0) warnings.push("缺少上装，建议补充可搭配单品");
    if (countFor("onePiece") === 0) {
      warnings.push("缺少连身款，造型节奏可能偏单一");
    }
    const dominant = breakdown.find((item) => item.count / total > 0.75);
    if (dominant) {
      warnings.push(`${dominant.label}占比过高，建议增加跨品类层次`);
    }
  }

  return { breakdown, total, warnings };
}

export function moveSeriesSlot(
  slots: readonly SeriesPlanSlot[],
  key: string,
  offset: -1 | 1,
  completedSlotKeys: ReadonlySet<string>,
): readonly SeriesPlanSlot[] {
  const index = slots.findIndex((slot) => slot.key === key);
  const targetIndex = index + offset;
  if (
    index < 0 ||
    targetIndex < 0 ||
    targetIndex >= slots.length ||
    completedSlotKeys.has(key) ||
    completedSlotKeys.has(slots[targetIndex]?.key ?? "")
  ) {
    return slots;
  }
  const moved = [...slots];
  const currentSlot = moved[index];
  const targetSlot = moved[targetIndex];
  if (!currentSlot || !targetSlot) return slots;
  moved[index] = targetSlot;
  moved[targetIndex] = currentSlot;
  return moved;
}

export function resizeSeriesSlots(
  slots: readonly SeriesPlanSlot[],
  targetCount: number,
  source: GarmentType | null,
  completedSlotKeys: ReadonlySet<string>,
): readonly SeriesPlanSlot[] {
  const desiredSlotCount = Math.min(
    MAX_SERIES_COUNT - 1,
    Math.max(1, targetCount - 1),
  );
  let resized = [...slots];
  while (resized.length > desiredSlotCount) {
    const removableIndex = resized.findLastIndex(
      (slot) => !completedSlotKeys.has(slot.key),
    );
    if (removableIndex < 0) break;
    resized.splice(removableIndex, 1);
  }
  while (resized.length < desiredSlotCount) {
    resized = appendRecommendedSlot(resized, source);
  }
  return resized;
}

export async function runSeriesPlan(
  slots: readonly SeriesPlanSlot[],
  completedSlotKeys: ReadonlySet<string>,
  generate: (slot: SeriesPlanSlot) => Promise<void>,
): Promise<string[]> {
  const errors: string[] = [];
  for (const slot of slots) {
    if (completedSlotKeys.has(slot.key)) continue;
    try {
      await generate(slot);
    } catch (reason) {
      errors.push(
        `${slot.name}：${reason instanceof Error ? reason.message : "生成失败"}`,
      );
    }
  }
  return errors;
}

function loadSeriesPlanDraft(
  collectionId: string,
  source: GarmentType | null,
): SeriesPlanDraft {
  if (typeof window === "undefined") {
    return createInitialSeriesPlanDraft(collectionId, source);
  }
  try {
    const raw = window.localStorage.getItem(
      `${SERIES_PLAN_STORAGE_PREFIX}${collectionId}`,
    );
    return raw
      ? (parsePersistedSeriesPlan(raw, collectionId, source) ??
          createInitialSeriesPlanDraft(collectionId, source))
      : createInitialSeriesPlanDraft(collectionId, source);
  } catch {
    return createInitialSeriesPlanDraft(collectionId, source);
  }
}

function persistSeriesPlanDraft(draft: SeriesPlanDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${SERIES_PLAN_STORAGE_PREFIX}${draft.ownerKey}`,
      JSON.stringify(draft),
    );
  } catch {
    // The editor remains usable when storage is blocked or over quota.
  }
}

function parseSeriesPlanSlot(value: unknown): SeriesPlanSlot | null {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    !value.key ||
    typeof value.name !== "string" ||
    value.name.length > 40 ||
    typeof value.direction !== "string" ||
    value.direction.length > MAX_GENERATION_PROMPT_LENGTH ||
    !isRecord(value.garmentType) ||
    typeof value.garmentType.code !== "string" ||
    typeof value.garmentType.label !== "string" ||
    value.garmentType.label.length > 64
  ) {
    return null;
  }
  const garmentType = value.garmentType;
  const option = GARMENT_TYPE_OPTIONS.find(
    (item) => item.code === garmentType.code,
  );
  if (!option) return null;
  return {
    direction: value.direction,
    garmentType: {
      code: option.code,
      label: String(garmentType.label),
    },
    key: value.key,
    name: value.name,
  };
}

function appendRecommendedSlot(
  slots: readonly SeriesPlanSlot[],
  source: GarmentType | null,
): SeriesPlanSlot[] {
  const template = buildSeriesPlan(source, slots.length + 2).at(-1) ?? {
    direction: "将系列 DNA 转译到新的服装品类。",
    garmentType: DEFAULT_GARMENT_TYPE,
    key: nextSeriesSlotKey(slots),
    name: "新增款式",
  };
  const key = slots.some((slot) => slot.key === template.key)
    ? nextSeriesSlotKey(slots)
    : template.key;
  return [...slots, { ...template, key }];
}

function nextSeriesSlotKey(slots: readonly SeriesPlanSlot[]): string {
  for (let index = 1; index <= MAX_SERIES_COUNT; index += 1) {
    const key = `slot-local-${String(index).padStart(2, "0")}`;
    if (!slots.some((slot) => slot.key === key)) return key;
  }
  return `slot-local-${Date.now().toString(36)}`;
}

function reconcileSelection(
  current: ReadonlySet<string>,
  previousSlots: readonly SeriesPlanSlot[],
  nextSlots: readonly SeriesPlanSlot[],
  completedSlotKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  const previousKeys = new Set(previousSlots.map((slot) => slot.key));
  return new Set(
    nextSlots
      .filter(
        (slot) =>
          !completedSlotKeys.has(slot.key) &&
          (current.has(slot.key) || !previousKeys.has(slot.key)),
      )
      .map((slot) => slot.key),
  );
}

function withoutKey(
  keys: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  const next = new Set(keys);
  next.delete(key);
  return next;
}

function garmentTypeSignature(source: GarmentType | null): string {
  return `${source?.code ?? ""}:${source?.label ?? ""}`;
}

function seriesCategory(code: GarmentType["code"]): SeriesCategory {
  if (code === "jacket" || code === "coat") return "outerwear";
  if (code === "pants" || code === "shorts" || code === "skirt") {
    return "bottom";
  }
  if (code === "dress" || code === "jumpsuit") return "onePiece";
  if (code === "custom") return "custom";
  return "top";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recommendedGarmentCodes(
  sourceCode: GarmentType["code"] | undefined,
): readonly GarmentType["code"][] {
  if (sourceCode === "jacket" || sourceCode === "coat") {
    return ["top", "pants", "shorts", "dress", "shirt", "knit", "skirt"];
  }
  if (sourceCode === "dress") {
    return ["tshirt", "shirt", "vest", "pants", "jacket", "skirt", "knit"];
  }
  if (sourceCode === "pants" || sourceCode === "shorts") {
    return ["jacket", "shirt", "knit", "dress", "tshirt", "vest", "coat"];
  }
  return ["jacket", "shirt", "pants", "dress", "knit", "skirt", "coat"];
}

function slotStatusLabel(status: SlotStatus | "completed"): string {
  return {
    completed: "已完成",
    failed: "生成失败",
    idle: "未生成",
    running: "生成中",
  }[status];
}

async function waitForGeneration(taskId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_TASK_POLLS; attempt += 1) {
    const task = await fetchGenerationTask(taskId);
    if (task.status === "succeeded") return;
    if (
      task.status === "failed" ||
      task.status === "moderation_failed" ||
      task.status === "canceled"
    ) {
      throw new Error(task.error?.message ?? "系列 Look 生成未完成");
    }
    await delay(TASK_POLL_MS);
  }
  throw new Error("系列 Look 生成等待超时，请稍后在系列中查看");
}

async function waitForSimilarity(
  refresh: () => Promise<CollectionConsistency>,
  previousLookCount: number,
): Promise<CollectionConsistency> {
  let latest = await refresh();
  for (let attempt = 0; attempt < MAX_ANALYSIS_POLLS; attempt += 1) {
    const hasNewLook = latest.looks.length > previousLookCount;
    const analyzing = latest.looks.some(
      (look) =>
        look.analysisStatus === "pending" || look.analysisStatus === "running",
    );
    if (hasNewLook && !analyzing) return latest;
    await delay(ANALYSIS_POLL_MS);
    latest = await refresh();
  }
  return latest;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function appendMessage(
  messages: Map<string, string[]>,
  assetId: string,
  message: string,
): void {
  messages.set(assetId, [...(messages.get(assetId) ?? []), message]);
}

function firstAvailableAxis(dna: CollectionDna): CollectionVariationAxis {
  const axes: readonly CollectionVariationAxis[] = [
    "silhouette",
    "fabric",
    "color",
    "detail",
    "styling",
  ];
  return axes.find((axis) => !axisLocked(axis, dna)) ?? "detail";
}

function axisLocked(
  axis: CollectionVariationAxis,
  dna: CollectionDna,
): boolean {
  if (axis === "color") return dna.locks.palette;
  if (axis === "silhouette") return dna.locks.silhouettes;
  if (axis === "fabric") return dna.locks.fabrics;
  if (axis === "styling") return dna.locks.moodWords;
  return false;
}

function axisLabel(axis: CollectionVariationAxis | null): string {
  if (!axis) return "未标记";
  return {
    color: "色彩",
    detail: "细节",
    fabric: "面料",
    garmentType: "服装类型",
    silhouette: "廓形",
    styling: "造型",
  }[axis];
}

function statusLabel(
  status: "failed" | "pending" | "ready" | "running",
): string {
  return {
    failed: "计算失败",
    pending: "等待计算",
    ready: "—",
    running: "计算中",
  }[status];
}
