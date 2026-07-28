"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  createCollectionLook,
  forceKeepCollectionLook,
} from "./collection-api";
import type {
  CollectionConsistency,
  CollectionDna,
  CollectionVariationAxis,
} from "./collection-types";
import { fetchGenerationTask } from "./generation-api";
import styles from "./generation.module.css";
import { VariationAxisSelector } from "./VariationAxisSelector";

const TASK_POLL_MS = 1_200;
const ANALYSIS_POLL_MS = 1_500;
const MAX_TASK_POLLS = 100;
const MAX_ANALYSIS_POLLS = 80;

export function LookGrid({
  beforeGenerate,
  collectionId,
  consistency,
  dna,
  onRefresh,
}: {
  readonly beforeGenerate: () => Promise<void>;
  readonly collectionId: string;
  readonly consistency: CollectionConsistency;
  readonly dna: CollectionDna;
  readonly onRefresh: () => Promise<CollectionConsistency>;
}) {
  const [axis, setAxis] = useState<CollectionVariationAxis>(() =>
    firstAvailableAxis(dna),
  );
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const effectiveAxis = axisLocked(axis, dna) ? firstAvailableAxis(dna) : axis;

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
      if (!mounted.current) return;
      setDirection("");
      await waitForSimilarity(onRefresh, previousLookCount);
    } catch (reason) {
      if (mounted.current) {
        setError(
          reason instanceof Error ? reason.message : "系列 Look 生成失败",
        );
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

  return (
    <section className={styles.lookLab}>
      <header>
        <div>
          <span>COLLECTION EXPANSION</span>
          <h2>扩展新 Look</h2>
        </div>
        <strong>{consistency.looks.length} LOOKS</strong>
      </header>

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
                    {look.isHero ? "HERO" : axisLabel(look.variationAxis)}
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

async function waitForGeneration(taskId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_TASK_POLLS; attempt += 1) {
    const task = await fetchGenerationTask(taskId);
    if (task.status === "succeeded") return;
    if (task.status === "failed" || task.status === "canceled") {
      throw new Error(task.error?.message ?? "系列 Look 生成未完成");
    }
    await delay(TASK_POLL_MS);
  }
  throw new Error("系列 Look 生成等待超时，请稍后在系列中查看");
}

async function waitForSimilarity(
  refresh: () => Promise<CollectionConsistency>,
  previousLookCount: number,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_ANALYSIS_POLLS; attempt += 1) {
    const next = await refresh();
    const hasNewLook = next.looks.length > previousLookCount;
    const analyzing = next.looks.some(
      (look) =>
        look.analysisStatus === "pending" || look.analysisStatus === "running",
    );
    if (hasNewLook && !analyzing) return;
    await delay(ANALYSIS_POLL_MS);
  }
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
