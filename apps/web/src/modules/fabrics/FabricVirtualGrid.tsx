"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Grid, type CellComponentProps } from "react-window";

import type { Fabric } from "./fabric-types";
import { FabricCard } from "./FabricCard";
import styles from "./fabrics.module.css";

interface GridCellData {
  readonly columnCount: number;
  readonly compact: boolean;
  readonly fabrics: readonly Fabric[];
  readonly onAdd?: ((fabric: Fabric) => void) | undefined;
  readonly onChanged?: (() => void) | undefined;
}

function FabricCell({
  columnCount,
  columnIndex,
  compact,
  fabrics,
  onAdd,
  onChanged,
  rowIndex,
  style,
}: CellComponentProps<GridCellData>) {
  const index = rowIndex * columnCount + columnIndex;
  const fabric = fabrics[index];
  if (!fabric) return <div style={style} />;

  return (
    <div className={styles.virtualCell} style={style}>
      <FabricCard
        compact={compact}
        fabric={fabric}
        key={fabric.id}
        onAdd={onAdd}
        onChanged={onChanged}
        variant={(rowIndex + columnIndex) % 3 === 0 ? "tall" : "short"}
      />
    </div>
  );
}

interface FabricVirtualGridProps {
  readonly compact?: boolean;
  readonly fabrics: readonly Fabric[];
  readonly height?: number;
  readonly onAdd?: ((fabric: Fabric) => void) | undefined;
  readonly onChanged?: (() => void) | undefined;
  readonly onNearEnd?: () => void;
}

export function FabricVirtualGrid({
  compact = false,
  fabrics,
  height = 680,
  onAdd,
  onChanged,
  onNearEnd,
}: FabricVirtualGridProps) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(compact ? 264 : 960);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const columnCount = compact
    ? 1
    : Math.max(1, Math.min(4, Math.floor(width / 260)));
  const rowCount = Math.ceil(fabrics.length / columnCount);
  const cellProps = useMemo<GridCellData>(
    () => ({ columnCount, compact, fabrics, onAdd, onChanged }),
    [columnCount, compact, fabrics, onAdd, onChanged],
  );

  return (
    <div className={styles.virtualGridHost} ref={host}>
      <Grid
        cellComponent={FabricCell}
        cellProps={cellProps}
        columnCount={columnCount}
        columnWidth={Math.max(220, width / columnCount)}
        onCellsRendered={({ rowStopIndex }) => {
          if (rowStopIndex >= rowCount - 2) onNearEnd?.();
        }}
        overscanCount={2}
        rowCount={rowCount}
        rowHeight={compact ? 338 : 448}
        style={{ height, width }}
      />
    </div>
  );
}
