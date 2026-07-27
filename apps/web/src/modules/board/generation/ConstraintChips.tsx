"use client";

import type { BoardElementRole } from "@fashion/shared";

import styles from "./generation.module.css";

const LABELS: Readonly<Record<BoardElementRole, string>> = {
  avoid: "避用",
  detail_ref: "细节",
  fabric_ref: "面料",
  note: "备注",
  palette: "色彩",
  silhouette_ref: "廓形",
  style_ref: "风格",
};

export function ConstraintChips({
  roles,
}: {
  readonly roles: readonly BoardElementRole[];
}) {
  const counts = roles.reduce<Partial<Record<BoardElementRole, number>>>(
    (result, role) => {
      result[role] = (result[role] ?? 0) + 1;
      return result;
    },
    {},
  );

  return (
    <div className={styles.constraintChips} aria-label="当前生成约束">
      {Object.entries(counts).map(([role, count]) => (
        <span data-role={role} key={role}>
          {LABELS[role as BoardElementRole]} {count}
        </span>
      ))}
    </div>
  );
}

