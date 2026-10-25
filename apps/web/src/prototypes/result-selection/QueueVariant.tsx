"use client";
import { useState } from "react";
import { Button } from "../../components/ui";
import { CandidateCard, type VariantProps } from "./shared";
import styles from "./prototype.module.css";
export function QueueVariant(props: VariantProps) {
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<
    { index: number; selected: boolean }[]
  >([]);
  const item = props.items[index];
  const decide = (keep: boolean) => {
    if (!item) return;
    const selected = props.selected.has(item.id);
    setHistory((current) => [...current, { index, selected }]);
    if (selected !== keep) props.onToggle(item.id);
    setIndex(index + 1);
  };
  return (
    <section aria-label="审阅队列" className={styles.queue}>
      <aside className={styles.stack}>
        <h2>逐张确认</h2>
        <p>
          {Math.min(index + 1, props.items.length)} / {props.items.length} 张
        </p>
        <progress
          aria-label="审阅进度"
          max={props.items.length || 1}
          value={index}
        />
        <Button
          disabled={!history.length || props.readOnly}
          onClick={() => {
            const last = history.at(-1);
            if (!last) return;
            const previous = props.items[last.index];
            if (previous && props.selected.has(previous.id) !== last.selected)
              props.onToggle(previous.id);
            setIndex(last.index);
            setHistory(history.slice(0, -1));
          }}
        >
          撤销上一步
        </Button>
        <Button
          onClick={() => {
            setIndex(0);
            setHistory([]);
          }}
        >
          从头查看
        </Button>
      </aside>
      <div className={styles.stack}>
        {item ? (
          <>
            <CandidateCard item={item} {...props} />
            <div className={styles.actions}>
              <Button
                variant="primary"
                disabled={props.readOnly || item.state !== "ready"}
                onClick={() => decide(true)}
              >
                保留并继续
              </Button>
              <Button disabled={props.readOnly} onClick={() => decide(false)}>
                跳过
              </Button>
            </div>
          </>
        ) : (
          <div className={styles.empty}>
            <h2>本批审阅完成</h2>
            <p>已保留 {props.selected.size} 张。选择仍仅保存在本地演示中。</p>
          </div>
        )}
      </div>
    </section>
  );
}
