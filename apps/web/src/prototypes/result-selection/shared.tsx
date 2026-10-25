"use client";
import { Button, ImagePreview } from "../../components/ui";
import type { Candidate } from "./fixtures";
import styles from "./prototype.module.css";

export interface VariantProps {
  readonly items: Candidate[];
  readonly selected: ReadonlySet<string>;
  readonly readOnly: boolean;
  readonly onToggle: (id: string) => void;
  readonly onInspect: (id: string) => void;
  readonly onRetry: (id: string) => void;
}
export const stateLabel = {
  ready: "可挑选",
  running: "生成中",
  failed: "生成失败",
  queued: "等待开始",
};
export function CandidateCard({
  item,
  ...props
}: VariantProps & { readonly item: Candidate }) {
  return (
    <article
      className={styles.card}
      data-selected={props.selected.has(item.id)}
    >
      <div className={styles.image}>
        <ImagePreview src={item.image} alt={item.name} />
      </div>
      <div className={styles.cardBody}>
        <span className={styles.meta}>
          {item.id.replace("candidate-", "样本 ")} · {stateLabel[item.state]}
        </span>
        <h3 title={item.name}>{item.name}</h3>
        <div className={styles.actions}>
          <Button onClick={() => props.onInspect(item.id)}>
            查看原图与来源
          </Button>
          {item.state === "failed" ? (
            <Button
              disabled={props.readOnly}
              onClick={() => props.onRetry(item.id)}
            >
              演示重试
            </Button>
          ) : (
            <Button
              disabled={props.readOnly || item.state !== "ready"}
              aria-pressed={props.selected.has(item.id)}
              onClick={() => props.onToggle(item.id)}
            >
              {props.selected.has(item.id) ? "取消选择" : "选择候选"}
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
