"use client";

import { Children, useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { Group, Panel, Separator, useGroupRef, usePanelRef, type Layout } from "react-resizable-panels";
import { useAuth } from "../modules/auth/AuthProvider";
import styles from "./workspace-split.module.css";

export function WorkspaceSplit({ children, docked, open, onOpenChange, projectId, ...props }: ComponentProps<"div"> & {
  children: ReactNode; docked: boolean; open: boolean; onOpenChange: (open: boolean) => void; projectId: string;
}) {
  const { session } = useAuth();
  const group = useGroupRef();
  const assistant = usePanelRef();
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDialogElement>(null);
  const start = useRef<Layout | null>(null);
  const canceled = useRef(false);
  const lastWidth = useRef(384);
  const lastOpen = useRef<boolean | null>(null);
  const skipPreference = useRef(false);
  const latest = useRef({ open, onOpenChange });
  useLayoutEffect(() => { latest.current = { open, onOpenChange }; }, [open, onOpenChange]);
  const storageKey = session ? `fashion:workspace-split:${session.user.id}:${projectId}` : "";
  useEffect(() => {
    if (!docked) return;
    let width = 384;
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { width?: number; open?: boolean } | null; if (saved?.width) width = Math.max(320, Math.min(480, saved.width)); if (saved?.open !== undefined && !new URLSearchParams(window.location.search).has("conversationId")) latest.current.onOpenChange(saved.open); } catch { /* Defaults remain usable. */ }
    lastWidth.current = width;
    const frame = requestAnimationFrame(() => assistant.current?.resize(width));
    return () => cancelAnimationFrame(frame);
  }, [storageKey, docked, assistant]);
  useEffect(() => {
    if (!docked) return;
    if (open) assistant.current?.expand(); else assistant.current?.collapse();
    if (lastOpen.current !== null && lastOpen.current !== open && storageKey && !skipPreference.current) {
      try { localStorage.setItem(storageKey, JSON.stringify({ width: lastWidth.current, open })); } catch { /* Optional layout preferences. */ }
    }
    skipPreference.current = false;
    lastOpen.current = open;
  }, [open, docked, assistant, storageKey]);
  useEffect(() => {
    const cancel = () => {
      if (!start.current) return;
      const previous = start.current; start.current = null; canceled.current = true; skipPreference.current = true;
      // Cancel the library's native pointer gesture before restoring its baseline.
      document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
      group.current?.setLayout(previous);
      latest.current.onOpenChange((previous.assistant ?? 0) > 0);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && start.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    const finish = () => { start.current = null; };
    window.addEventListener("keydown", key, true); window.addEventListener("blur", cancel);
    window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", cancel);
    return () => { cancel(); window.removeEventListener("keydown", key, true); window.removeEventListener("blur", cancel); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", cancel); };
  }, [docked, group]);
  useEffect(() => {
    const dialog = overlay.current;
    if (!dialog) return;
    const mobile = matchMedia("(max-width: 767px)");
    let previous: HTMLElement | null = null;
    const update = () => {
      const modal = !docked && !mobile.matches && open;
      dialog.dataset.inline = String(docked || mobile.matches);
      dialog.setAttribute("role", modal ? "dialog" : "presentation");
      if (modal) dialog.setAttribute("aria-label", "设计助手面板"); else dialog.removeAttribute("aria-label");
      if (modal && !dialog.open) {
        previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
        dialog.querySelector<HTMLElement>("textarea, button")?.focus({ preventScroll: true });
      } else if (!modal && dialog.open) {
        dialog.close();
        if (!open && previous?.isConnected) previous.focus({ preventScroll: true });
      }
    };
    update(); mobile.addEventListener("change", update);
    return () => { mobile.removeEventListener("change", update); if (dialog.open) dialog.close(); };
  }, [docked, open]);
  const panels = Children.toArray(children);
  return <div {...props} ref={host} className={`${props.className ?? ""} ${styles.root}`} data-split-docked={docked}>
    <Group className={styles.group} groupRef={group} disabled={!docked} resizeTargetMinimumSize={{ fine: 8, coarse: 44 }} onLayoutChanged={(layout, meta) => {
      if (!meta.isUserInteraction || canceled.current) { canceled.current = false; return; }
      const size = Math.round((layout.assistant ?? 0) * Math.max(0, (host.current?.clientWidth ?? 1256) - 6) / 100);
      if (size >= 320) lastWidth.current = size;
      latest.current.onOpenChange((layout.assistant ?? 0) > 0);
      try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ width: lastWidth.current, open: size > 0 })); } catch { /* Storage is optional. */ }
    }}>
      <Panel id="artwork" minSize={docked ? 640 : 0} className={styles.panel}>{panels[0]}</Panel>
      <Separator aria-label="调整侧栏宽度" className={styles.separator} hidden={!docked || !open} onPointerDownCapture={() => { start.current = group.current?.getLayout() ?? null; canceled.current = false; }} onKeyDownCapture={event => { if (event.key !== "Escape") canceled.current = false; }} onDoubleClick={() => { lastWidth.current = 384; assistant.current?.resize(384); try { if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ width: 384, open: true })); } catch { /* Optional layout preference. */ } }} />
      <Panel id="assistant" panelRef={assistant} defaultSize={384} minSize={docked ? 320 : 0} maxSize={docked ? 480 : "100%"} collapsible collapsedSize={0} collapsedThreshold={48} groupResizeBehavior="preserve-pixel-size" className={styles.panel}><dialog ref={overlay} role="presentation" className={styles.overlay} data-inline={docked} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); onOpenChange(false); }}>{panels[1]}</dialog></Panel>
    </Group>
  </div>;
}
