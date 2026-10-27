"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export interface WorkspaceDraft {
  readonly owner: string;
  readonly value: unknown;
  readonly baseline: string;
  readonly dirty: boolean;
  readonly conflict: boolean;
  readonly locked: boolean;
}

/** Editors retain their working values; this registry owns project-wide leave protection. */
export class WorkspaceDraftStore {
  private entries = new Map<string, WorkspaceDraft>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private baselines = new Map<string, string>();
  private epochs = new Map<string, number>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  get(key: string) {
    return this.entries.get(key);
  }
  hasDirty = () => [...this.entries.values()].some((entry) => entry.dirty);
  ownerDirty(owner: string) {
    return [...this.entries.values()].some(
      (entry) => entry.owner === owner && entry.dirty,
    );
  }
  ownerLocked(owner: string) {
    return [...this.entries.values()].some(
      (entry) => entry.owner === owner && entry.locked,
    );
  }
  ownerConflict(owner: string) {
    return [...this.entries.values()].some(
      (entry) => entry.owner === owner && entry.conflict,
    );
  }
  ownerEpoch(owner: string) {
    return this.epochs.get(owner) ?? 0;
  }
  update(key: string, entry: WorkspaceDraft) {
    const previous = this.entries.get(key);
    if (previous && JSON.stringify(previous) === JSON.stringify(entry)) return;
    this.entries.set(key, entry);
    if (!this.ownerDirty(entry.owner)) {
      const baseline = this.baselines.get(entry.owner);
      if (baseline !== undefined && baseline !== entry.baseline)
        this.epochs.set(entry.owner, this.ownerEpoch(entry.owner) + 1);
      this.baselines.set(entry.owner, entry.baseline);
    }
    this.emit();
  }
  removeOwner(owner: string) {
    this.baselines.delete(owner);
    this.epochs.delete(owner);
    let changed = false;
    for (const [key, entry] of this.entries)
      if (entry.owner === owner) {
        this.entries.delete(key);
        changed = true;
      }
    if (changed) this.emit();
  }
  clear() {
    this.entries.clear();
    this.baselines.clear();
    this.epochs.clear();
    this.emit();
  }
  private emit() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }
}

const DraftContext = createContext<{
  store: WorkspaceDraftStore;
  owner: string;
  baseline: string;
} | null>(null);

export function WorkspaceDraftProvider({
  store,
  owner,
  baseline,
  children,
}: {
  store: WorkspaceDraftStore;
  owner: string;
  baseline: string;
  children: ReactNode;
}) {
  return (
    <DraftContext.Provider value={{ store, owner, baseline }}>
      {children}
    </DraftContext.Provider>
  );
}

export function useWorkspaceDraftOwner() { return useContext(DraftContext)?.owner; }

/** A remote revision must never silently replace an unsaved edit. */
export function useWorkspaceDraft(
  mode: string,
  value: unknown,
  dirty: boolean,
  locked = false,
) {
  const context = useContext(DraftContext);
  const base = context?.baseline ?? "";
  useEffect(() => {
    if (!context) return;
    const key = `${context.owner}:${mode}`;
    const previous = context.store.get(key);
    const baseline = dirty && previous ? previous.baseline : base;
    context.store.update(key, {
      owner: context.owner,
      value,
      baseline,
      dirty,
      conflict: dirty && baseline !== base,
      locked,
    });
  }, [base, context, dirty, locked, mode, value]);
}

export function useWorkspaceDraftRevision(store: WorkspaceDraftStore) {
  return useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
}
