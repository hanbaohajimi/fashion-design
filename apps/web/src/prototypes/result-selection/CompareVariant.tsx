"use client";
import { useState } from "react";
import { Button } from "../../components/ui";
import { CandidateCard, type VariantProps } from "./shared";
import styles from "./prototype.module.css";
export function CompareVariant(props: VariantProps) {
  const [left, setLeft] = useState(props.items[0]?.id ?? "");
  const [right, setRight] = useState(props.items[1]?.id ?? "");
  const [target, setTarget] = useState<"left" | "right">("right");
  return (
    <section aria-label="专注比较" className={styles.stack}>
      <div className={styles.actions}>
        <span>将候选放到：</span>
        <Button
          aria-pressed={target === "left"}
          onClick={() => setTarget("left")}
        >
          左侧
        </Button>
        <Button
          aria-pressed={target === "right"}
          onClick={() => setTarget("right")}
        >
          右侧
        </Button>
      </div>
      <div className={styles.compare}>
        {[left, right].map((id, index) => {
          const item = props.items.find((entry) => entry.id === id);
          return item ? (
            <CandidateCard key={index} item={item} {...props} />
          ) : (
            <div key={index} className={styles.empty}>
              从候选列表挑选一张图片开始比较
            </div>
          );
        })}
      </div>
      <div className={styles.candidateStrip} aria-label="比较候选列表">
        {props.items.map((item) => (
          <Button
            key={item.id}
            aria-pressed={item.id === left || item.id === right}
            onClick={() =>
              target === "left" ? setLeft(item.id) : setRight(item.id)
            }
          >
            {item.name}
          </Button>
        ))}
      </div>
    </section>
  );
}
