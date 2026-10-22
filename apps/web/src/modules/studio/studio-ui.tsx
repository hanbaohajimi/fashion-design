"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, ImagePreview, Notice } from "../../components/ui";
import { HISTORY_POSITION, navigationPosition, registerNavigationGuard, registerTraversalGuard } from "../navigation";
import styles from "./studio.module.css";
import { userFacingError } from "../../components/user-facing-error";

export interface StudioAsset { readonly id: string; readonly url: string; readonly thumbnailUrl: string | null }
export function errorMessage(error: unknown): string { return userFacingError(error); }

export function AssetPicker({ assets, selected, onChange, max = 1, label = "选择设计图片", disabled = false }: {
  readonly assets: readonly StudioAsset[]; readonly selected: readonly string[]; readonly onChange: (ids: string[]) => void;
  readonly max?: number; readonly label?: string; readonly disabled?: boolean;
}) {
  const [limit, setLimit] = useState(false);
  return <div className={styles.stack}><div className={styles.recordHeader}><strong>{label}</strong><small className={styles.muted}>{selected.length} / {max}</small></div>{assets.length ? <div className={styles.previewGrid}>{assets.map((asset, index) => <button aria-label={"选择图片 " + (index + 1)} aria-pressed={selected.includes(asset.id)} className={styles.assetButton} disabled={disabled} key={asset.id} onClick={() => {
    if (selected.includes(asset.id)) { onChange(selected.filter((id) => id !== asset.id)); setLimit(false); }
    else if (selected.length < max) { onChange([...selected, asset.id]); setLimit(false); }
    else setLimit(true);
  }} type="button"><span className={styles.assetImage}><ImagePreview src={asset.thumbnailUrl ?? asset.url} alt={"设计图片 " + (index + 1)} /></span><span className={styles.assetLabel}>图片 {index + 1}</span></button>)}</div> : <p className={styles.note}>还没有设计图片。先从任务入口上传草图或在画布生成候选。</p>}{limit ? <Notice tone="error">最多选择 {max} 张，请先取消一张。</Notice> : null}</div>;
}

export function SaveBar({ busy, dirty, canEdit = true, children }: { readonly busy: boolean; readonly dirty: boolean; readonly canEdit?: boolean; readonly children?: ReactNode }) {
  return <div className={styles.actions}><Button type="submit" variant="primary" loading={busy} disabled={!canEdit || !dirty}>保存修订</Button><small className={styles.muted}>{dirty ? "有未保存的修改" : "已保存"}</small>{children}</div>;
}

export function useStudioLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  const resolveRef = useRef<((leave: boolean) => void) | null>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const confirmLeave = async (): Promise<boolean> => {
    if (!dirtyRef.current) return true;
    setOpen(true);
    return new Promise((resolve) => { resolveRef.current = resolve; });
  };
  useEffect(() => {
    let leaving = false;
    let restoring = false;
    let permitted = false;
    let traversal = 0;
    const ask = async () => {
      if (!dirtyRef.current) return;
      setOpen(true);
      const leave = await new Promise<boolean>((resolve) => { resolveRef.current = resolve; });
      if (!leave) throw new Error("保留未保存内容");
      dirtyRef.current = false;
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    const unregister = registerNavigationGuard(ask);
    const click = (event: MouseEvent) => {
      if (!dirtyRef.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname && url.search === location.search) return;
      event.preventDefault(); event.stopPropagation();
      if (leaving) return;
      leaving = true;
      void ask().then(() => router.push(url.pathname + url.search + url.hash)).catch(() => undefined).finally(() => { leaving = false; });
    };
    const popstate = (event: PopStateEvent) => {
      if (permitted) { permitted = false; return; }
      if (restoring) {
        event.stopImmediatePropagation(); restoring = false;
        void ask().then(() => { permitted = true; history.go(-traversal); }).catch(() => { leaving = false; });
        return;
      }
      if (!dirtyRef.current) return;
      event.stopImmediatePropagation(); if (leaving) return;
      traversal = navigationPosition() - Number(event.state?.[HISTORY_POSITION] ?? 0);
      if (!traversal) return;
      leaving = true; restoring = true; history.go(traversal);
    };
    const untraverse = registerTraversalGuard(popstate);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); unregister(); untraverse(); resolveRef.current?.(false); };
  }, [router]);
  const dialog = open ? <Dialog label="保留未保存的修改" onClose={() => { resolveRef.current?.(false); setOpen(false); }}><div className={styles.section}><h2>当前内容尚未保存</h2><p>继续离开会丢弃这次表单修改。</p><div className={styles.toolbar}><Button onClick={() => { resolveRef.current?.(false); setOpen(false); }}>继续编辑</Button><Button variant="danger" onClick={() => { resolveRef.current?.(true); setOpen(false); }}>丢弃并离开</Button></div></div></Dialog> : null;
  return { confirmLeave, dialog };
}
