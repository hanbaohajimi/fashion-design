"use client";

import { useState } from "react";

import { createCollectionLook } from "./collection-api";
import type {
  CollectionConsistency,
  GarmentType,
  StandardGarmentType,
} from "./collection-types";
import { GARMENT_TYPE_OPTIONS } from "./collection-types";
import { fetchGenerationTask } from "./generation-api";
import { useGenerationWorkspace } from "./GenerationWorkspace";
import styles from "./generation.module.css";
import { captureAnalytics } from "../../../observability/analytics";

const TASK_POLL_MS = 1_200;
const ANALYSIS_POLL_MS = 1_500;
const MAX_TASK_POLLS = 300;
const MAX_ANALYSIS_POLLS = 80;
const DEFAULT_GARMENT_TYPE: GarmentType = { code: "top", label: "上装" };

export function LookGrid({
  beforeGenerate,
  collectionId,
  consistency,
  sourceGarmentType,
  onRefresh,
}: {
  readonly beforeGenerate: () => Promise<void>;
  readonly collectionId: string;
  readonly consistency: CollectionConsistency;
  readonly sourceGarmentType: GarmentType | null;
  readonly onRefresh: () => Promise<CollectionConsistency>;
}) {
  const { track } = useGenerationWorkspace();
  const initialType = sourceGarmentType ?? DEFAULT_GARMENT_TYPE;
  const [garmentCode, setGarmentCode] = useState<StandardGarmentType>(
    initialType.code,
  );
  const [customLabel, setCustomLabel] = useState(
    initialType.code === "custom" ? initialType.label : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const garmentType = resolveGarmentType(garmentCode, customLabel);

  const generate = async (): Promise<void> => {
    if (busy || !garmentType) return;
    setBusy(true);
    setError(null);
    try {
      await beforeGenerate();
      const previousLookCount = consistency.looks.length;
      const taskId = await createCollectionLook(
        collectionId,
        "garmentType",
        undefined,
        garmentType,
        `manual-${crypto.randomUUID()}`,
      );
      await waitForGeneration(taskId);
      await track(taskId);
      captureAnalytics("collection_look_generated", {
        garment_type: garmentType.code,
        variation_axis: "garmentType",
      });
      await waitForNewLook(onRefresh, previousLookCount);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "服装生成失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.lookLab}>
      <div className={styles.lookGenerator}>
        <label>
          <span>服装类型</span>
          <select
            disabled={busy}
            onChange={(event) =>
              setGarmentCode(event.target.value as StandardGarmentType)
            }
            value={garmentCode}
          >
            {GARMENT_TYPE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {garmentCode === "custom" ? (
          <label>
            <span>自定义类型</span>
            <input
              disabled={busy}
              maxLength={64}
              onChange={(event) => setCustomLabel(event.target.value)}
              placeholder="输入服装类型"
              value={customLabel}
            />
          </label>
        ) : null}

        <button
          disabled={busy || !garmentType}
          onClick={() => void generate()}
          type="button"
        >
          {busy ? "生成中" : "生成"}
        </button>
      </div>

      {error ? (
        <p className={styles.lookError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.lookGrid}>
        {consistency.looks
          .filter((look) => !look.isHero)
          .map((look) => (
            <article key={look.assetId}>
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt={look.garmentType?.label ?? "生成的服装"}
                  src={look.thumbnailUrl ?? look.url}
                />
                <figcaption>{look.garmentType?.label ?? "服装"}</figcaption>
              </figure>
            </article>
          ))}
      </div>
    </section>
  );
}

export function resolveGarmentType(
  code: StandardGarmentType,
  customLabel: string,
): GarmentType | null {
  if (code === "custom") {
    const label = customLabel.trim();
    return label ? { code, label } : null;
  }
  return GARMENT_TYPE_OPTIONS.find((option) => option.code === code) ?? null;
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
      throw new Error(task.error?.message ?? "服装生成未完成");
    }
    await delay(TASK_POLL_MS);
  }
  throw new Error("服装生成等待超时，请稍后查看");
}

async function waitForNewLook(
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
