"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { canvasObjectType, filterCanvasObjects, orderCanvasObjects, readCanvasObjects, type CanvasObjectOrder, type CanvasObjectRow } from "./canvas-objects";
import { toggleCanvasObjectVisibility, visibleCanvasBounds } from "./canvas-visibility";
import styles from "./canvas-objects.module.css";
import type { CanvasHistoryTarget } from "./CanvasObjectHistory";

const paths: Record<string, ReactNode> = {
  close: <path d="m6 6 12 12M18 6 6 18" />,
  history: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  locked: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  unlocked: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2M12 14v3" /></>,
  visible: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  hidden: <><path d="m3 3 18 18M9.5 5.3A12 12 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 4M6 6a18 18 0 0 0-4 6s3.5 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4" /></>,
  locate: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M12 2v5m0 10v5M2 12h5m10 0h5" /></>,
  front: <><path d="M5 4h14M12 20V8m-5 5 5-5 5 5" /></>,
  forward: <path d="M12 20V4m-5 5 5-5 5 5" />,
  backward: <path d="M12 4v16m-5-5 5 5 5-5" />,
  back: <><path d="M5 20h14M12 4v12m-5-5 5 5 5-5" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>,
  note: <><path d="M4 3h16v13l-5 5H4ZM15 21v-5h5M8 8h8M8 12h5" /></>,
  frame: <path d="M7 2v20M17 2v20M2 7h20M2 17h20" />,
  group: <><rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" /><path d="M7 7h4v4H7ZM13 13h4v4h-4Z" /></>,
  swatch: <><rect x="3" y="5" width="6" height="14" rx="1" /><rect x="9" y="5" width="6" height="14" rx="1" /><rect x="15" y="5" width="6" height="14" rx="1" /></>,
  draw: <path d="m4 16-1 5 5-1L20 8a2 2 0 0 0-4-4ZM14 6l4 4" />,
  text: <path d="M4 5V3h16v2M12 3v18M8 21h8" />,
  object: <rect x="4" y="4" width="16" height="16" rx="2" />,
};

function Icon({ name }: { name: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.object}</svg>;
}

const orders: readonly [CanvasObjectOrder, string][] = [["front", "置于顶层"], ["forward", "上移一层"], ["backward", "下移一层"], ["back", "置于底层"]];

export const CanvasObjectsPanel = memo(function CanvasObjectsPanel({ editable, onClose, onHistory, id }: { editable: boolean; onClose: () => void; onHistory: (target: CanvasHistoryTarget) => void; id: string }) {
  const editor = useEditor();
  const panel = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const projection = useValue("canvas-object-list", () => JSON.stringify({
    rows: readCanvasObjects(editor),
    selected: editor.getSelectedShapeIds(),
    readonly: editor.getIsReadonly(),
  }), [editor]);
  const { rows, selected, readonly } = useMemo(() => JSON.parse(projection) as { rows: CanvasObjectRow[]; selected: TLShapeId[]; readonly: boolean }, [projection]);
  const canEdit = editable && !readonly;
  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  const visible = useMemo(() => filterCanvasObjects(rows, query, collapsed), [rows, query, collapsed]);
  const selectedSet = new Set(selected);
  const selectedRows = rows.filter(row => selectedSet.has(row.id));
  const protectedSelection = selectedRows.some(row => row.isLocked || row.ancestorLocked || row.isHidden || row.ancestorHidden);
  const canOrder = canEdit && selected.length > 0 && !protectedSelection;
  const allLocked = selectedRows.length > 0 && selectedRows.every(row => row.isLocked);

  const locate = () => {
    if (editor.getSelectedShapeIds().some(id => editor.isShapeHidden(id))) return;
    const bounds = visibleCanvasBounds(editor, editor.getSelectedShapeIds());
    if (!bounds) return;
    const viewport = editor.getViewportScreenBounds();
    const compact = viewport.w < 800 || viewport.h < 600;
    const coveredWidth = compact ? 0 : (panel.current?.offsetWidth ?? 300) + 16;
    const targetZoom = Math.min(1, editor.getZoomLevel(),
      Math.max(1, viewport.w - coveredWidth - 96) / Math.max(1, bounds.w),
      Math.max(1, viewport.h - 240) / Math.max(1, bounds.h));
    if (compact) onClose();
    editor.zoomToBounds(bounds, { targetZoom, inset: 48 });
    if (coveredWidth) editor.centerOnPoint({ x: bounds.center.x - coveredWidth / (2 * editor.getZoomLevel()), y: bounds.center.y });
  };
  const toggleLock = (ids: TLShapeId[]) => {
    if (!editable || editor.getIsReadonly() || ids.some(id => {
      const shape = editor.getShape(id);
      return !shape || editor.isShapeOrAncestorLocked(editor.getShapeParent(shape));
    })) return;
    editor.markHistoryStoppingPoint("切换对象锁定");
    editor.toggleLock(ids);
  };
  const selectRow = (id: TLShapeId, additive: boolean) => {
    if (!editor.getShape(id) || editor.isShapeHidden(id)) return;
    editor.complete();
    editor.setCurrentTool("select");
    if (additive) {
      const current = editor.getSelectedShapeIds();
      editor.setSelectedShapes(current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    } else editor.select(id);
  };

  return <section ref={panel} tabIndex={-1} id={id} className={styles.panel} aria-label="画布对象" data-canvas-objects
    onWheel={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); onClose(); }
    }}>
    <div className={styles.header}>
      <h2>画布对象 <span>{rows.length}</span></h2>
      <button type="button" aria-label="关闭画布对象" onClick={onClose}><Icon name="close" /></button>
    </div>
    <label className={styles.search}>
      <Icon name="search" />
      <input type="search" aria-label="查找画布对象" placeholder="查找对象" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    <div className={styles.list} role="list" aria-label="画布对象列表">
      {visible.map(row => {
        const locked = row.isLocked || row.ancestorLocked;
        const hidden = row.isHidden || row.ancestorHidden;
        const open = Boolean(query.trim()) || !collapsed.has(row.id);
        return <div key={row.id} role="listitem" className={styles.row} data-canvas-object-id={row.id} data-selected={selectedSet.has(row.id)} data-locked={locked} data-hidden={hidden} style={{ "--object-depth": Math.min(5, row.depth) } as CSSProperties}>
          {row.hasChildren ? <button type="button" className={styles.disclosure} aria-label={`${open ? "收起" : "展开"} ${row.label}`} aria-expanded={open} disabled={Boolean(query.trim())} onClick={() => setCollapsed(previous => {
            const next = new Set(previous);
            if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
            return next;
          })}><Icon name="chevron" /></button> : <span className={styles.disclosureSpace} />}
          <button type="button" className={styles.select} aria-label={`选择 ${row.label}`} aria-pressed={selectedSet.has(row.id)} disabled={hidden} title={`${row.label}\n${hidden ? "已隐藏，请先显示对象" : canvasObjectType(row.type)}`} onClick={event => selectRow(row.id, event.shiftKey || event.metaKey || event.ctrlKey)} onDoubleClick={locate}>
            <Icon name={row.type.replace("fashion-", "")} /><span>{row.label}</span>
          </button>
          {row.assetId ? <button type="button" className={styles.history} aria-label={`查看 ${row.label} 的历史`} title="查看图片版本与设计路径" onClick={() => {
            const shape = editor.getShape(row.id);
            const props = shape?.props as Record<string, unknown> | undefined;
            if (shape && typeof props?.assetId === "string" && props.assetId) onHistory({ assetId: props.assetId, title: row.label, nodeId: typeof shape.meta.canvasNodeId === "string" ? shape.meta.canvasNodeId : null });
          }}><Icon name="history" /><span className={styles.historyLabel}>查看历史</span></button> : null}
          <button type="button" className={styles.visibility} aria-label={row.ancestorHidden ? `${row.label} 随父级隐藏` : `${row.isHidden ? "显示" : "隐藏"} ${row.label}`} title={row.ancestorHidden ? "随父级隐藏，请先显示父级" : row.isHidden ? "显示对象" : "隐藏对象"} disabled={!canEdit || row.ancestorHidden} onClick={() => { if (editable) toggleCanvasObjectVisibility(editor, row.id); }}><Icon name={hidden ? "hidden" : "visible"} /></button>
          <button type="button" className={styles.lock} aria-label={row.ancestorLocked ? `${row.label} 随父级锁定` : `${row.isLocked ? "解锁" : "锁定"} ${row.label}`} title={row.ancestorLocked ? "随父级锁定，请先解锁父级" : row.isLocked ? "解锁对象" : "锁定对象"} disabled={!canEdit || row.ancestorLocked} onClick={() => toggleLock([row.id])}><Icon name={locked ? "locked" : "unlocked"} /></button>
        </div>;
      })}
      {!visible.length ? <p className={styles.empty}>{query.trim() ? "没有匹配的对象" : "画布上还没有对象"}</p> : null}
    </div>
    <div className={styles.footer}>
      <span>{selected.length ? `已选 ${selected.length} 项` : "选择对象以调整"}</span>
      <div role="toolbar" aria-label="对象层级操作">
        <button type="button" aria-label="定位所选对象" title="定位所选对象" disabled={!selected.length} onClick={locate}><Icon name="locate" /></button>
        {orders.map(([order, label]) => <button type="button" key={order} aria-label={label} title={label} disabled={!canOrder} onClick={() => orderCanvasObjects(editor, order)}><Icon name={order} /></button>)}
        <button type="button" aria-label={allLocked ? "解锁所选对象" : "锁定所选对象"} title={allLocked ? "解锁所选对象" : "锁定所选对象"} disabled={!canEdit || !selected.length || selectedRows.some(row => row.ancestorLocked)} onClick={() => toggleLock(selected)}><Icon name={allLocked ? "unlocked" : "locked"} /></button>
      </div>
    </div>
  </section>;
});
