import { useSyncExternalStore } from "react";

export interface LocalActivity { id: string; accountId: string; projectId: string; name: string; stage: string; cancel: () => void; }
let entries: readonly LocalActivity[] = [];
const empty: readonly LocalActivity[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
export function setLocalActivity(activity: LocalActivity) { entries = [...entries.filter(item => item.id !== activity.id), activity]; emit(); }
export function removeLocalActivity(id: string) { entries = entries.filter(item => item.id !== id); emit(); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLocalActivities() { return useSyncExternalStore(subscribe, () => entries, () => empty); }
