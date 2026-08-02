"use client";

import type { DragEvent } from "react";

import {
  FABRIC_DRAG_MIME,
  fabricToDragPayload,
} from "../board/fabric-drag";
import {
  FABRIC_CATEGORY_LABELS,
  FABRIC_METRIC_STEPS,
  FABRIC_SEASON_LABELS,
  FABRIC_WEAVE_LABELS,
  getCompositionEntries,
  getFabricMetrics,
  getFabricSeasons,
  type Fabric,
} from "./fabric-types";
import styles from "./fabrics.module.css";

const METRIC_STEPS = Array.from({ length: FABRIC_METRIC_STEPS }, (_, index) => index + 1);

interface FabricCardProps {
  readonly compact?: boolean;
  readonly fabric: Fabric;
  readonly onAdd?: ((fabric: Fabric) => void) | undefined;
  readonly variant?: "short" | "tall";
}

export function FabricCard({
  compact = false,
  fabric,
  onAdd,
  variant = "short",
}: FabricCardProps) {
  const composition = getCompositionEntries(fabric.attributes)
    .slice(0, 2)
    .map(([name, percentage]) => `${name} ${percentage}%`)
    .join(" · ");
  const metrics = getFabricMetrics(fabric.attributes);
  const weave = fabric.attributes.weave;
  const seasons = getFabricSeasons(fabric.attributes)
    .map((season) => FABRIC_SEASON_LABELS[season] ?? season)
    .join("/");

  const onDragStart = (event: DragEvent<HTMLElement>): void => {
    const payload = fabricToDragPayload(fabric);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(FABRIC_DRAG_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", fabric.name);
  };

  return (
    <article
      aria-label={`${fabric.name}，拖拽到白板`}
      className={styles.fabricCard}
      data-compact={compact}
      data-variant={variant}
      draggable
      onDragStart={onDragStart}
    >
      <div className={styles.cardVisual}>
        <span className={styles.cardIndex}>{fabric.scope === "preset" ? "ARCHIVE" : "MY FABRIC"}</span>
        {/* The authenticated same-origin endpoint redirects to the private object URL. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={fabric.name} draggable={false} loading="lazy" src={fabric.mainImageUrl} />
        <span className={styles.dragHint}>拖至白板 ↗</span>
      </div>
      <div className={styles.cardBody}>
        <span className={styles.categoryPill}>
          {FABRIC_CATEGORY_LABELS[fabric.category] ?? fabric.category}
        </span>
        <h3>{fabric.name}</h3>
        <p>{composition || fabric.subCategory || "成分待补充"}</p>
        {metrics.length > 0 ? (
          <dl className={styles.handfeel}>
            {metrics.map((metric) => (
              <div className={styles.metricRow} key={metric.name}>
                <dt>{metric.name}</dt>
                <span aria-hidden className={styles.metricGauge}>
                  {METRIC_STEPS.map((step) => (
                    <b data-on={step <= metric.level} key={step} />
                  ))}
                </span>
                <dd>{metric.label}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className={styles.cardFacts}>
          <span>{fabric.attributes.weight ? `${fabric.attributes.weight} GSM` : "GSM —"}</span>
          <span>{weave ? FABRIC_WEAVE_LABELS[weave] ?? weave : "织法未标注"}</span>
          {seasons ? <span>{seasons}</span> : null}
        </div>
        {onAdd ? (
          <button onClick={() => onAdd(fabric)} type="button">
            添加到白板
          </button>
        ) : null}
      </div>
    </article>
  );
}
