"use client";

/**
 * DataTable — 通用数据表格基元
 *
 * 特性：
 * - sticky 表头（`position: sticky`）
 * - tabular-nums 对齐数字
 * - 行高 36px（density-row token）
 * - hover / 选中态
 * - 左侧 checkbox 多选（可选）
 * - 排序指示（可选）
 * - hairline 行分隔
 */

import {
  useId,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import styles from "./data-table.module.css";

export interface DataColumn<T> {
  readonly key: string;
  readonly header: string;
  /** 渲染单元格内容 */
  readonly render: (row: T, index: number) => ReactNode;
  /** 列宽（CSS 值） */
  readonly width?: string;
  /** 是否为数字列（右对齐 + tabular-nums） */
  readonly numeric?: boolean;
  /** 是否可排序 */
  readonly sortable?: boolean;
  /** 单元格 className */
  readonly className?: string;
}

type SortDirection = "asc" | "desc";

interface DataTableProps<T> {
  readonly columns: readonly DataColumn<T>[];
  readonly rows: readonly T[];
  readonly getRowKey: (row: T, index: number) => string;
  /** 是否显示行复选框 */
  readonly selectable?: boolean;
  /** 受控选中项 key 集合 */
  readonly selectedKeys?: ReadonlySet<string>;
  readonly onSelectionChange?: (keys: Set<string>) => void;
  /** 行点击 */
  readonly onRowClick?: (row: T, index: number) => void;
  /** 空状态 */
  readonly emptyState?: ReactNode;
  /** 额外 className */
  readonly className?: string;
  readonly style?: CSSProperties;
  /** 受控排序 */
  readonly sortKey?: string;
  readonly sortDirection?: SortDirection;
  readonly onSort?: (key: string, direction: SortDirection) => void;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  onRowClick,
  emptyState,
  className,
  style,
  sortKey,
  sortDirection,
  onSort,
}: DataTableProps<T>) {
  const checkboxId = useId();
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selected = selectedKeys ?? internalSelected;
  const setSelected = onSelectionChange ?? setInternalSelected;

  const allKeys = rows.map((r, i) => getRowKey(r, i));
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = !allSelected && allKeys.some((k) => selected.has(k));

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allKeys));
  };

  const toggleRow = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const handleSort = (col: DataColumn<T>) => {
    if (!col.sortable || !onSort) return;
    const next: SortDirection =
      sortKey === col.key && sortDirection === "asc" ? "desc" : "asc";
    onSort(col.key, next);
  };

  return (
    <div className={`${styles.wrapper} ${className ?? ""}`} style={style}>
      <table className={styles.table}>
        <thead className={styles.thead}>
          <tr className={styles.headerRow}>
            {selectable && (
              <th className={`${styles.th} ${styles.checkCell}`} scope="col">
                <input
                  id={`${checkboxId}-all`}
                  type="checkbox"
                  className={styles.checkbox}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label="全选"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={`${styles.th} ${col.numeric ? styles.numeric : ""} ${col.sortable ? styles.sortable : ""}`}
                style={col.width ? { width: col.width } : undefined}
                onClick={col.sortable ? () => handleSort(col) : undefined}
                aria-sort={
                  sortKey === col.key
                    ? sortDirection === "asc"
                      ? "ascending"
                      : "descending"
                    : col.sortable
                    ? "none"
                    : undefined
                }
              >
                <span className={styles.thContent}>
                  {col.header}
                  {col.sortable && (
                    <svg
                      className={`${styles.sortIcon} ${sortKey === col.key ? styles.sortActive : ""} ${sortKey === col.key && sortDirection === "desc" ? styles.sortDesc : ""}`}
                      viewBox="0 0 8 10"
                      width="8"
                      height="10"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M4 1L7 4H1L4 1Z" fill="currentColor" />
                      <path d="M4 9L1 6H7L4 9Z" fill="currentColor" opacity="0.4" />
                    </svg>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={styles.tbody}>
          {rows.length === 0 && emptyState != null ? (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0)}
                className={styles.emptyCell}
              >
                {emptyState}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const key = getRowKey(row, i);
              const isSelected = selected.has(key);
              return (
                <tr
                  key={key}
                  className={`${styles.tr} ${isSelected ? styles.trSelected : ""} ${onRowClick ? styles.trClickable : ""}`}
                  onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                  aria-selected={selectable ? isSelected : undefined}
                >
                  {selectable && (
                    <td className={`${styles.td} ${styles.checkCell}`} onClick={(e) => e.stopPropagation()}>
                      <input
                        id={`${checkboxId}-${key}`}
                        type="checkbox"
                        className={styles.checkbox}
                        checked={isSelected}
                        onChange={() => toggleRow(key)}
                        aria-label={`选中行 ${i + 1}`}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`${styles.td} ${col.numeric ? styles.numeric : ""} ${col.className ?? ""}`}
                    >
                      {col.render(row, i)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
