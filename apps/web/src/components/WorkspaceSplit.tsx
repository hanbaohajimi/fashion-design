"use client";

import { Children, useEffect, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { Group, Panel, Separator, useGroupRef, usePanelRef, type Layout } from "react-resizable-panels";
import { useAuth } from "../modules/auth/AuthProvider";
import styles from "./workspace-split.module.css";
import { readWorkspacePreference, saveWorkspacePreference, workspacePreferenceKey } from "./workspace-preferences";
import { ASSISTANT_WINDOW, type AssistantPresentation } from "./assistant-window-geometry";
import { AssistantWindowContext, useFloatingAssistant } from "./AssistantWindow";

export function WorkspaceSplit({ children, docked, open, onOpenChange, projectId, panelLabel = "设计助手面板", manageOpenPreference = true, focusInputOnOpen = true, assistantWindow, embedded = false, ...props }: ComponentProps<"div"> & {
  children: ReactNode; docked: boolean; open: boolean; onOpenChange: (open: boolean) => void; projectId: string; panelLabel?: string; manageOpenPreference?: boolean; focusInputOnOpen?: boolean;
  assistantWindow?: { mode: "floating" | "docked" | "mobile"; canDock: boolean; onPresentationChange: (value: AssistantPresentation) => void; onClose: () => void };
  embedded?: boolean;
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
  const storageKey = session ? workspacePreferenceKey(session.user.id, projectId) : "";
  const floating = assistantWindow?.mode === "floating";
  const hasAssistantWindow = Boolean(assistantWindow);
  const floatingWindow = useFloatingAssistant(host, overlay, storageKey, floating && open, hasAssistantWindow);
  const defaultWidth = assistantWindow ? ASSISTANT_WINDOW.width : 420;
  const minWidth = assistantWindow ? ASSISTANT_WINDOW.minWidth : 360;
  const maxWidth = assistantWindow ? ASSISTANT_WINDOW.maxWidth : 640;
  useEffect(() => {
    if (!docked) return;
    let width = 384;
    const saved = readWorkspacePreference(storageKey, hasAssistantWindow ? { defaultWidth: 400, minWidth: 360, maxWidth: 600 } : {});
    width = saved.width;
    if (manageOpenPreference && saved.open !== undefined && !new URLSearchParams(window.location.search).has("conversationId")) latest.current.onOpenChange(saved.open);
    lastWidth.current = width;
    const frame = requestAnimationFrame(() => {
      if (latest.current.open) assistant.current?.resize(width);
      else assistant.current?.collapse();
    });
    return () => cancelAnimationFrame(frame);
  }, [storageKey, docked, assistant, manageOpenPreference, hasAssistantWindow]);
  useEffect(() => {
    if (!docked) return;
    if (open) { assistant.current?.expand(); assistant.current?.resize(lastWidth.current); }
    else assistant.current?.collapse();
    if (manageOpenPreference && lastOpen.current !== null && lastOpen.current !== open && storageKey && !skipPreference.current) {
      saveWorkspacePreference(storageKey, { width: lastWidth.current, open });
    }
    skipPreference.current = false;
    lastOpen.current = open;
  }, [open, docked, assistant, storageKey, manageOpenPreference]);
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
    if (hasAssistantWindow) {
      dialog.dataset.inline = String(!floating);
      dialog.setAttribute("role", "presentation");
      return;
    }
    const mobile = matchMedia("(max-width: 767px)");
    let previous: HTMLElement | null = null;
    const update = () => {
      const modal = !embedded && !docked && !mobile.matches && open;
      dialog.dataset.inline = String(embedded || docked || mobile.matches);
      dialog.setAttribute("role", modal ? "dialog" : "presentation");
      if (modal) dialog.setAttribute("aria-label", panelLabel); else dialog.removeAttribute("aria-label");
      if (modal && !dialog.open) {
        previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
        dialog.querySelector<HTMLElement>(focusInputOnOpen ? "textarea" : "button")?.focus({ preventScroll: true });
      } else if (!modal && dialog.open) {
        dialog.close();
        if (!open && previous?.isConnected) previous.focus({ preventScroll: true });
      }
    };
    update(); mobile.addEventListener("change", update);
    return () => { mobile.removeEventListener("change", update); if (dialog.open) dialog.close(); };
  }, [docked, open, panelLabel, focusInputOnOpen, hasAssistantWindow, floating, embedded]);
  const panels = Children.toArray(children);
  return <AssistantWindowContext.Provider value={assistantWindow ? { mode: assistantWindow.mode, canDock: assistantWindow.canDock, setPresentation: assistantWindow.onPresentationChange, close: assistantWindow.onClose, reset: floatingWindow.reset, dragProps: floatingWindow.dragProps } : null}><div {...props} ref={host} className={`${props.className ?? ""} ${styles.root}`} data-assistant-window={assistantWindow?.mode} data-split-docked={docked}>
    <Group className={styles.group} groupRef={group} disabled={!docked} resizeTargetMinimumSize={{ fine: 8, coarse: 44 }} onLayoutChanged={(layout, meta) => {
      if (!meta.isUserInteraction || canceled.current) { canceled.current = false; return; }
      const size = Math.round((layout.assistant ?? 0) * Math.max(0, (host.current?.clientWidth ?? 1256) - 6) / 100);
      if (size >= 320) lastWidth.current = size;
      latest.current.onOpenChange((layout.assistant ?? 0) > 0);
      saveWorkspacePreference(storageKey, { width: lastWidth.current, open: size > 0 });
    }}>
      <Panel id="artwork" minSize={docked ? 640 : 0} className={styles.panel}>{panels[0]}</Panel>
      <Separator aria-label="调整侧栏宽度" className={styles.separator} hidden={!docked || !open} onPointerDownCapture={() => { start.current = group.current?.getLayout() ?? null; canceled.current = false; }} onKeyDownCapture={event => { if (event.key !== "Escape") canceled.current = false; }} onDoubleClick={() => { lastWidth.current = defaultWidth; assistant.current?.resize(defaultWidth); saveWorkspacePreference(storageKey, { width: defaultWidth, open: true }); }} />
      <Panel id="assistant" panelRef={assistant} defaultSize={open ? defaultWidth : 0} minSize={docked ? minWidth : 0} maxSize={docked ? maxWidth : "100%"} collapsible collapsedSize={0} collapsedThreshold={48} groupResizeBehavior="preserve-pixel-size" className={styles.panel}><dialog ref={overlay} role="presentation" className={styles.overlay} data-inline={docked} data-floating={floating || undefined} {...(assistantWindow ? { open: floating && open } : {})} onCancel={event => { if (event.target !== event.currentTarget) return; event.preventDefault(); onOpenChange(false); }}>{panels[1]}{floatingWindow.handles}</dialog></Panel>
    </Group>
  </div></AssistantWindowContext.Provider>;
}
