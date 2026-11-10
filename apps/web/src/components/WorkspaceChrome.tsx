"use client";

import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { ConnectionNotice } from "./interactions/ConnectionNotice";
import { NAVIGATION_PREFERENCE_EVENT, readNavigationPreference, saveNavigationPreference, type WorkspaceNavigationKind } from "./workspace-navigation-preferences";
import styles from "./workspace-chrome.module.css";

const subscribePreference = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener(NAVIGATION_PREFERENCE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(NAVIGATION_PREFERENCE_EVENT, listener);
  };
};
const subscribeViewport = (listener: () => void) => {
  const media = matchMedia("(max-width: 1199px)");
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const compactViewport = () => matchMedia("(max-width: 1199px)").matches;
const desktopViewport = () => false;

interface ChromeState {
  kind: WorkspaceNavigationKind;
  compact: boolean;
  open: boolean;
  focused: boolean;
  setOpen: (open: boolean) => void;
  setFocused: (owner: string, focused: boolean) => void;
}
const ChromeContext = createContext<ChromeState>({ kind: "document", compact: false, open: true, focused: false, setOpen: () => undefined, setFocused: () => undefined });
export const useWorkspaceChrome = () => useContext(ChromeContext);
type ChromeActions = Pick<ChromeState, "compact" | "setOpen" | "setFocused">;
const ChromeActionsContext = createContext<ChromeActions>({ compact: false, setOpen: () => undefined, setFocused: () => undefined });
export const useWorkspaceChromeActions = () => useContext(ChromeActionsContext);

/** Layout preferences never key or replace the editor, conversation or draft scope. */
export function WorkspaceChrome({ accountId, kind, routeKey, children }: {
  accountId: string | null;
  kind: WorkspaceNavigationKind;
  routeKey: string;
  children: ReactNode;
}) {
  const compact = useSyncExternalStore(subscribeViewport, compactViewport, desktopViewport);
  const preferredOpen = useSyncExternalStore(subscribePreference,
    () => accountId ? readNavigationPreference(accountId, kind) : kind === "document",
    () => kind === "document");
  // A mobile drawer is opened deliberately; it does not overwrite desktop preferences.
  const [drawer, setDrawer] = useState({ scope: "", open: false });
  const [focusOwners, setFocusOwners] = useState<string[]>([]);
  const scope = `${accountId ?? ""}:${routeKey}`;
  const focused = focusOwners.length > 0;
  const open = !focused && (compact ? drawer.scope === scope && drawer.open : preferredOpen);
  const setOpen = useCallback((next: boolean) => {
    if (compact) setDrawer({ scope, open: next });
    else if (accountId) saveNavigationPreference(accountId, kind, next);
  }, [accountId, compact, kind, scope]);
  const setFocused = useCallback((owner: string, active: boolean) => {
    setFocusOwners(previous => active ? previous.includes(owner) ? previous : [...previous, owner] : previous.filter(value => value !== owner));
  }, []);
  // Editors only issue commands. Opening the directory must not repaint their entire trees.
  const actions = useMemo(() => ({ compact, setOpen, setFocused }), [compact, setOpen, setFocused]);
  const value = useMemo(() => ({ kind, compact, open, focused, setOpen, setFocused }), [kind, compact, open, focused, setOpen, setFocused]);
  return <ChromeActionsContext value={actions}><ChromeContext value={value}>
    <div className={styles.chrome} data-workspace-chrome data-navigation-kind={kind} data-nav-reserved={!compact && open} data-nav-open={open} data-focused-editor={focused}>
      {children}
      {/* Keep the server shell stable when auth resolves before this boundary hydrates. */}
      <div className={styles.connection}>{accountId ? <ConnectionNotice /> : null}</div>
    </div>
  </ChromeContext></ChromeActionsContext>;
}

export function useWorkspaceFocusMode(active: boolean) {
  const { setFocused } = useWorkspaceChromeActions();
  const owner = useId();
  useLayoutEffect(() => {
    if (!active) return;
    setFocused(owner, true);
    return () => setFocused(owner, false);
  }, [active, owner, setFocused]);
}
