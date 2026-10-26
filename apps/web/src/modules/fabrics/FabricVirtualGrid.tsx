"use client";

import { VirtuosoGrid } from "react-virtuoso";

import type { Fabric } from "./fabric-types";
import { FabricCard } from "./FabricCard";
import styles from "./fabrics.module.css";

interface FabricVirtualGridProps {
  readonly compact?: boolean;
  readonly fabrics: readonly Fabric[];
  readonly height?: number | string;
  readonly scrollMode?: "window" | "container";
  readonly addingId?: string | null;
  readonly onAdd?: ((fabric: Fabric) => void) | undefined;
  readonly onChanged?: (() => void) | undefined;
  readonly onNearEnd?: () => void;
}

export function FabricVirtualGrid({
  compact = false,
  fabrics,
  height = 680,
  scrollMode = "container",
  addingId,
  onAdd,
  onChanged,
  onNearEnd,
}: FabricVirtualGridProps) {
  return (
    <div className={styles.virtualGridHost}>
      <VirtuosoGrid
        aria-label="面料卡片列表"
        useWindowScroll={scrollMode === "window"}
        style={scrollMode === "container" ? { height } : undefined}
        data={fabrics}
        computeItemKey={(_, fabric) => fabric.id}
        overscan={200}
        endReached={() => onNearEnd?.()}
        listClassName={styles.virtualGrid ?? ""}
        itemClassName={styles.virtualCell ?? ""}
        itemContent={(_, fabric) => {
          return (
            <FabricCard
              compact={compact}
              fabric={fabric}
              key={fabric.id}
              onAdd={onAdd}
              adding={addingId === fabric.id}
              addDisabled={Boolean(addingId)}
              onChanged={onChanged}
            />
          );
        }}
      />
    </div>
  );
}
