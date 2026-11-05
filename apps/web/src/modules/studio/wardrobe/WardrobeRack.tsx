"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { WardrobeItemView, WardrobeRevisionView } from "@fashion/shared";
import { Button, Dialog, Field, Input, Notice, Select } from "../../../components/ui";
import { CATEGORY_LABELS, rackDisplacement } from "./wardrobe-state";
import { GarmentDisplay } from "./GarmentDisplay";
import { packRackItems, rackSlotWidth } from "./garment-geometry";
import styles from "./wardrobe.module.css";

export function WardrobeRack({ projectId, items, canEdit, initialAssetId, selectedRevisionIds = [], layeringItemIds = [], additionNotice, additionError, onAdd, onLayer, onUndo, onPrepare, onArchive, onRevise }: {
  projectId: string; items: WardrobeItemView[]; canEdit: boolean; initialAssetId?: string | undefined;
  selectedRevisionIds?: string[]; onRevise: (item: WardrobeItemView) => void;
  layeringItemIds?: string[]; additionNotice?: string | null | undefined;
  additionError?: string | null | undefined;
  onLayer?: ((item: WardrobeRevisionView) => void) | undefined; onUndo?: (() => void) | undefined;
  onAdd: (item: WardrobeRevisionView) => void; onPrepare: () => void;
  onArchive: (item: WardrobeItemView, archived: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(6);
  const [rackWidth, setRackWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(() => items.find(item => item.currentRevision.assetId === initialAssetId)?.id ?? null);
  const [focusOpen, setFocusOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const focusPiece = useRef<HTMLDivElement>(null);
  const focusStage = useRef<HTMLDivElement>(null);
  const origin = useRef<DOMRect | null>(null);
  const transition = useRef<Animation | null>(null);
  const closing = useRef(false);
  useEffect(() => {
    if (!focusOpen) return;
    closing.current = false;
    const frame = requestAnimationFrame(() => {
      const target = focusPiece.current;
      if (!target || !origin.current || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const box = target.getBoundingClientRect();
      const source = origin.current;
      transition.current = target.animate?.([
        { transform: `translate(calc(-50% + ${source.left - box.left}px), ${source.top - box.top}px) scale(${source.width / Math.max(box.width, 1)}, ${source.height / Math.max(box.height, 1)})` },
        { transform: "translate(-50%, 0) scale(1)" },
      ], { duration: 430, easing: "cubic-bezier(.16,1,.3,1)" }) ?? null;
    });
    return () => { cancelAnimationFrame(frame); transition.current?.cancel(); };
  }, [focusOpen]);
  const closeFocus = () => {
    if (closing.current) return;
    closing.current = true;
    const target = focusPiece.current;
    const sourceElement = buttons.current.find(button => button?.dataset.itemId === focusId)?.querySelector<HTMLElement>(`[data-garment]`);
    const source = sourceElement?.getBoundingClientRect() ?? origin.current;
    transition.current?.cancel();
    if (!target || !source || !target.animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setFocusOpen(false); return; }
    const box = target.getBoundingClientRect();
    transition.current = target.animate([
      { transform: "translate(-50%, 0) scale(1)", opacity: 1 },
      { transform: `translate(calc(-50% + ${source.left - box.left}px), ${source.top - box.top}px) scale(${source.width / Math.max(box.width, 1)}, ${source.height / Math.max(box.height, 1)})`, opacity: 0.25 },
    ], { duration: 240, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
    void transition.current.finished.then(() => setFocusOpen(false), () => setFocusOpen(false));
  };
  useEffect(() => {
    if (!host.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setRackWidth(entry.contentRect.width);
      setSize(entry.contentRect.width >= 740 ? 10 : entry.contentRect.width >= 540 ? 8 : entry.contentRect.width >= 400 ? 6 : 4);
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter(item => item.archived === archived && (!category || item.currentRevision.category === category) && `${item.name} ${CATEGORY_LABELS[item.currentRevision.category]}`.toLocaleLowerCase().includes(query));
  }, [items, archived, category, search]);
  const pages = useMemo(() => {
    const hasWideItems = filtered.some(item => item.currentRevision.display === "hook" || item.currentRevision.display === "shelf");
    return packRackItems(filtered, hasWideItems ? rackWidth * .88 : Infinity, size);
  }, [filtered, rackWidth, size]);
  const maxPage = Math.max(0, pages.length - 1);
  const currentPage = Math.min(page, maxPage);
  const visible = pages[currentPage];
  // Geometry only changes with a different rack layout or image, never with the pointer.
  const measureSlots = useMemo(() => visible?.map((_, index) => (bottom: number, footprint: { left: number; right: number }) => {
    const button = buttons.current[index];
    const stage = button?.parentElement?.parentElement;
    if (!button || !stage || !rail.current) return;
    const box = button.getBoundingClientRect();
    const frame = stage.getBoundingClientRect();
    const bar = rail.current.getBoundingClientRect();
    const center = box.left + box.width / 2;
    const shift = Math.max(frame.left + 8 - center - footprint.left, Math.min(0, frame.right - 8 - center - footprint.right));
    button.style.setProperty("--label-top", `${bottom + 32}px`);
    button.style.setProperty("--active-shift", `${shift}px`);
    // Keep the hook clear of both end brackets, including during neighbor displacement.
    button.style.setProperty("--rail-min-shift", `${bar.left + 8 - center}px`);
    button.style.setProperty("--rail-max-shift", `${bar.right - 8 - center}px`);
  }), [visible]);
  const spacious = visible?.some(item => item.currentRevision.display === "hook" || item.currentRevision.display === "shelf");
  const slotWidths = visible?.map(item => rackSlotWidth(item.currentRevision)) ?? [];
  const focusedIndex = filtered.findIndex(item => item.id === focusId);
  const focused = filtered[focusedIndex];
  const changeFocus = (delta: number) => {
    const nextIndex = focusedIndex + delta;
    const item = filtered[nextIndex];
    if (!item) return;
    const trigger = delta > 0 ? focusStage.current?.querySelector<HTMLButtonElement>("button[aria-label='下一件单品']") : focusStage.current?.querySelector<HTMLButtonElement>("button[aria-label='上一件单品']");
    if ((nextIndex === 0 || nextIndex === filtered.length - 1) && document.activeElement === trigger) {
      // A focused button loses browser focus when navigation disables it at an edge.
      focusStage.current?.focus({ preventScroll: true });
    }
    setFocusId(item.id);
  };
  const reset = () => { setPage(0); setActive(null); };
  return <section className={styles.collection} aria-label="项目单品衣架" ref={host}>
    <div className={styles.filters}>
      <Field label="查找单品"><Input type="search" value={search} placeholder="输入名称" onChange={event => { setSearch(event.target.value); reset(); }} /></Field>
      <Field label="品类"><Select value={category} onChange={event => { setCategory(event.target.value); reset(); }}><option value="">全部品类</option>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
      <Button aria-pressed={archived} onClick={() => { setArchived(!archived); reset(); }}>{archived ? "查看陈列中单品" : "查看已收起单品"}</Button>
    </div>
    {visible?.length ? <>
      <div className={styles.rackStage} data-tall={visible.some(item => ["outerwear", "onepiece"].includes(item.currentRevision.category) || item.currentRevision.display === "shelf") || undefined} data-focused={focusOpen || undefined} onPointerLeave={() => setActive(null)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setActive(null); }}>
        <div className={styles.rail} ref={rail} data-rack-rail aria-hidden="true"><i /><span /><i /></div>
        <div className={styles.rackSlots} data-spacious={spacious || undefined} style={{ "--rack-count": visible.length, "--rack-width": `${slotWidths.reduce((sum, width) => sum + width, 0)}px`, "--rack-columns": slotWidths.map(width => `minmax(0, ${width}fr)`).join(" ") } as CSSProperties}>
          {visible.map((item, index) => <button key={item.id} ref={element => { buttons.current[index] = element; }} className={styles.rackSlot} type="button" data-item-id={item.id}
            aria-label={`查看单品：${item.name}`} data-active={active === index || undefined}
            onPointerEnter={event => { if (event.pointerType !== "touch") setActive(index); }} onFocus={() => setActive(index)}
            onClick={event => { origin.current = event.currentTarget.querySelector<HTMLElement>("[data-garment]")?.getBoundingClientRect() ?? null; setFocusId(item.id); setFocusOpen(true); }}
            onKeyDown={event => {
              const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : -1;
              if (next >= 0 && next < visible.length) { event.preventDefault(); buttons.current[next]?.focus(); }
            }}>
            <span className={styles.rackVisual} data-dual-view={item.currentRevision.presentation?.sideDisplay?.reviewed || undefined} style={{ "--rack-shift": `${rackDisplacement(index, active) * (size <= 6 ? .65 : 1)}px`, "--rest-angle": item.currentRevision.display === "shelf" ? "24deg" : "73deg" } as CSSProperties}>
              <GarmentDisplay item={item.currentRevision} projectId={projectId} view={active === index ? "front" : "side"} onExtent={measureSlots?.[index]} rackMotion />
            </span>
            <span className={styles.rackName}>{item.name}</span>
          </button>)}
        </div>
      </div>
      <div className={styles.rackFooter}><p><span className={styles.hoverHint}>移到单品上查看正面，点击聚焦查看</span><span className={styles.touchHint}>点击单品查看正面与详情，再加入搭配</span></p><div className={styles.actions}><Button disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setActive(null); }}>上一组</Button><span>{currentPage + 1} / {maxPage + 1}</span><Button disabled={currentPage === maxPage} onClick={() => { setPage(currentPage + 1); setActive(null); }}>下一组</Button></div></div>
    </> : <div className={styles.empty}><h3>{search || category ? "没有符合条件的单品" : archived ? "没有收起的单品" : "把当前项目的服装挂上衣架"}</h3><p>{search || category ? "换个名称或品类继续查找。" : "从设计图中准备独立单品，核对轮廓后开始陈列和搭配。"}</p>{!archived && canEdit ? <Button variant="primary" onClick={onPrepare}>准备第一件单品</Button> : null}</div>}
    {focused ? <Dialog open={focusOpen} label={`单品：${focused.name}`} className={styles.focusDialog} onClose={closeFocus} onAfterClose={() => setFocusId(null)}>
      <header className={styles.sectionHeader}><span>{focusedIndex + 1} / {filtered.length}</span><Button onClick={closeFocus}>返回衣架</Button></header>
      <div className={styles.focusStage} ref={focusStage} tabIndex={-1} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); changeFocus(event.key === "ArrowLeft" ? -1 : 1); } }}>
        <Button className={styles.previous} disabled={focusedIndex <= 0} onClick={() => changeFocus(-1)} aria-label="上一件单品">上一件</Button>
        <div className={styles.focusPiece} ref={focusPiece}><GarmentDisplay key={focused.currentRevision.id} item={focused.currentRevision} projectId={projectId} large onExtent={bottom => focusStage.current?.style.setProperty("--focus-height", `${bottom + 48}px`)} /></div>
        <Button className={styles.next} disabled={focusedIndex >= filtered.length - 1} onClick={() => changeFocus(1)} aria-label="下一件单品">下一件</Button>
      </div>
      <div className={styles.focusCaption}><h3>{focused.name}</h3><p>{CATEGORY_LABELS[focused.currentRevision.category]}<span>修订 {focused.currentRevision.version}</span>{focused.currentRevision.generatedCompletion ? <span>含生成补全，已人工核对</span> : null}</p>
        <div className={styles.actions}><Button variant="primary" disabled={!canEdit || focused.archived || selectedRevisionIds.includes(focused.currentRevision.id)} onClick={() => onAdd(focused.currentRevision)}>{selectedRevisionIds.includes(focused.currentRevision.id) ? "已加入搭配" : "加入搭配"}</Button>{layeringItemIds.includes(focused.id) ? <Button disabled={!canEdit || focused.archived || selectedRevisionIds.includes(focused.currentRevision.id)} onClick={() => onLayer?.(focused.currentRevision)}>叠穿加入</Button> : null}<Button disabled={!canEdit || focused.archived} onClick={() => onRevise(focused)}>准备新修订</Button><Button disabled={!canEdit} onClick={() => { onArchive(focused, !focused.archived); setFocusOpen(false); }}>{focused.archived ? "重新陈列" : "从衣架收起"}</Button></div>
        {additionNotice ? <Notice>{additionNotice}{onUndo ? <Button onClick={onUndo}>撤销本次搭配修改</Button> : null}</Notice> : null}
        {additionError ? <Notice tone="error">{additionError}</Notice> : null}
      </div>
    </Dialog> : null}
  </section>;
}
