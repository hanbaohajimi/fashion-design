"use client";

import { VirtuosoGrid } from "react-virtuoso";
import { useCallback, useState } from "react";

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
  const [flippedIds, setFlippedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const changeFlip = useCallback((id: string, flipped: boolean): void => {
    setFlippedIds((previous) => {
      if (previous.has(id) === flipped) return previous;
      const next = new Set(previous);
      if (flipped) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  return (
    <div
      className={`${styles.virtualGridHost} ${compact ? "" : styles.libraryGridHost}`}
    >
      <VirtuosoGrid
        aria-label="面料卡片列表"
        useWindowScroll={scrollMode === "window"}
        style={scrollMode === "container" ? { height } : undefined}
        data={fabrics}
        computeItemKey={(_, fabric) => fabric.id}
        overscan={200}
        endReached={() => onNearEnd?.()}
        listClassName={`${styles.virtualGrid} ${compact ? "" : styles.libraryVirtualGrid}`}
        itemClassName={`${styles.virtualCell} ${compact ? "" : styles.libraryVirtualCell}`}
        itemContent={(_, fabric) => {
          return (
            <FabricCard
              compact={compact}
              flipped={compact ? undefined : flippedIds.has(fabric.id)}
              onFlipChange={
                compact
                  ? undefined
                  : (flipped) => changeFlip(fabric.id, flipped)
              }
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
