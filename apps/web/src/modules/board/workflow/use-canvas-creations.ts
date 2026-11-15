"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createCanvasCreationSchema, runCanvasCreationSchema, updateCanvasCreationSchema, type CanvasCreation, type CreateCanvasCreationInput, type RunCanvasCreationInput, type UpdateCanvasCreationInput } from "@fashion/shared";
import { useDraftScope } from "../../../components/drafts/use-persistent-draft";
import { CanvasApiError } from "./canvas-api";
import { createCreation, fetchCreations, runCreation, updateCreation } from "./creation-api";

export function useCanvasCreations(projectId: string, enabled: boolean) {
  const scope = useDraftScope();
  const pendingKey = scope ? `fashion:creation-pending:${scope.accountId}:${projectId}` : "";
  const [initialPending] = useState(() => {
    const result = { runs: new Map<string, RunCanvasCreationInput>(), updates: new Map<string, { signature: string; input: UpdateCanvasCreationInput }>(), creates: new Map<string, CreateCanvasCreationInput>() };
    try {
      const saved: unknown = typeof window === "undefined" || !pendingKey ? {} : JSON.parse(sessionStorage.getItem(pendingKey) ?? "{}");
      const record = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, unknown> : { runs: saved };
      for (const pair of Array.isArray(record.runs) ? record.runs : []) if (Array.isArray(pair) && typeof pair[0] === "string") { const value = runCanvasCreationSchema.safeParse(pair[1]); if (value.success) result.runs.set(pair[0], value.data); }
      for (const pair of Array.isArray(record.creates) ? record.creates : []) if (Array.isArray(pair) && typeof pair[0] === "string") { const value = createCanvasCreationSchema.safeParse(pair[1]); if (value.success) result.creates.set(pair[0], value.data); }
      for (const pair of Array.isArray(record.updates) ? record.updates : []) if (Array.isArray(pair) && typeof pair[0] === "string" && pair[1] && typeof pair[1].signature === "string") { const value = updateCanvasCreationSchema.safeParse(pair[1].input); if (value.success) result.updates.set(pair[0], { signature: pair[1].signature, input: value.data }); }
    } catch { /* Corrupt recovery data is never submitted. */ }
    return result;
  });
  const [items, setItems] = useState<CanvasCreation[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const live = useRef({ items, active: true, epoch: 0 });
  const pending = useRef(initialPending.runs);
  const pendingUpdates = useRef(initialPending.updates);
  const pendingCreates = useRef(initialPending.creates);
  const [pendingIds, setPendingIds] = useState(() => [...initialPending.runs.keys()]);
  const [pendingUpdateIds, setPendingUpdateIds] = useState(() => [...initialPending.updates.keys()]);
  const runFlights = useRef(new Map<string, Promise<CanvasCreation>>());
  const [submittingIds, setSubmittingIds] = useState<string[]>([]);
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    const owner = live.current;
    owner.active = true;
    return () => { owner.active = false; owner.epoch++; };
  }, []);

  const persistPending = useCallback(() => {
    if (live.current.active) { setPendingIds([...pending.current.keys()]); setPendingUpdateIds([...pendingUpdates.current.keys()]); }
    if (!pendingKey) return;
    try { sessionStorage.setItem(pendingKey, JSON.stringify({ runs: [...pending.current], updates: [...pendingUpdates.current], creates: [...pendingCreates.current] })); } catch { /* In-memory recovery remains available. */ }
  }, [pendingKey]);

  const accept = useCallback((item: CanvasCreation) => {
    if (!live.current.active) throw new DOMException("工作区已变化", "AbortError");
    live.current.epoch++;
    const next = [...live.current.items.filter((current) => current.id !== item.id), item].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    live.current.items = next;
    setItems(next);
    setError(null);
    return item;
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const epoch = live.current.epoch;
    const result = await fetchCreations(projectId, signal);
    if (!live.current.active || epoch !== live.current.epoch) return;
    live.current.items = result.items;
    setItems(result.items);
    setCanEdit(result.canEdit);
    setLoaded(true);
    setError(null);
  }, [projectId]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await refresh(controller.signal); }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "创作记录载入失败"); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), live.current.items.some((item) => item.runs.some((run) => ["preparing", "queued", "running"].includes(run.status))) ? 2500 : 10000);
    };
    void poll();
    const onRefresh = () => { void refresh(controller.signal).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "创作记录同步失败"); }); };
    window.addEventListener("fashion-workflow:refresh", onRefresh);
    window.addEventListener("fashion-creations:refresh", onRefresh);
    return () => { controller.abort(); clearTimeout(timer); window.removeEventListener("fashion-workflow:refresh", onRefresh); window.removeEventListener("fashion-creations:refresh", onRefresh); };
  }, [enabled, refresh]);

  const serialized = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const task = queue.current.catch(() => undefined).then(async () => {
      if (!live.current.active) throw new Error("工作区已变化");
      live.current.epoch++;
      return work();
    });
    queue.current = task.then(() => undefined, () => undefined);
    return task;
  }, []);

  const create = useCallback((input: CreateCanvasCreationInput) => serialized(async () => {
    const signature = JSON.stringify({ title: input.title, module: input.module, draft: input.draft });
    const packet = pendingCreates.current.get(signature) ?? input;
    pendingCreates.current.set(signature, packet); persistPending();
    try {
      const result = await createCreation(projectId, packet); pendingCreates.current.delete(signature); persistPending(); return accept(result);
    } catch (cause) {
      if (cause instanceof CanvasApiError && [400, 403, 404, 409, 422].includes(cause.status)) { pendingCreates.current.delete(signature); persistPending(); }
      throw cause;
    }
  }), [accept, persistPending, projectId, serialized]);
  const update = useCallback((id: string, input: Omit<UpdateCanvasCreationInput, "mutationId" | "expectedRevision">, expectedRevision?: number) => serialized(async () => {
    const current = live.current.items.find((item) => item.id === id);
    if (!current) throw new Error("创作节点暂不可用，请重新载入");
    const signature = JSON.stringify(input);
    const known = pendingUpdates.current.get(id);
    if (known && known.signature !== signature) throw new Error("上次保存的回执尚未确认，请先重试原保存；当前输入仍保留。");
    const packet = known?.input ?? { ...input, mutationId: crypto.randomUUID(), expectedRevision: expectedRevision ?? current.revision };
    pendingUpdates.current.set(id, { signature, input: packet }); persistPending();
    try {
      const result = await updateCreation(projectId, id, packet);
      pendingUpdates.current.delete(id); persistPending(); accept(result);
      if (result.revision > packet.expectedRevision + 1) throw new CanvasApiError("上次保存已确认，但其他窗口还有更新；当前输入仍保留，请核对后继续。", 409);
      return result;
    }
    catch (cause) { if (cause instanceof CanvasApiError && [400, 403, 404, 409, 422].includes(cause.status)) { pendingUpdates.current.delete(id); persistPending(); } throw cause; }
  }), [accept, persistPending, projectId, serialized]);

  const run = useCallback((id: string, conversationId?: string) => {
    const existing = runFlights.current.get(id);
    if (existing) return existing;
    const flight = serialized(async () => {
    const current = live.current.items.find((item) => item.id === id);
    if (!current) throw new Error("创作节点暂不可用");
    const input = pending.current.get(id) ?? { mutationId: crypto.randomUUID(), expectedRevision: current.revision, ...(conversationId ? { conversationId } : {}) };
    pending.current.set(id, input);
    persistPending();
    try {
      const item = await runCreation(projectId, id, input);
      pending.current.delete(id);
      persistPending();
      return accept(item);
    } catch (cause) {
      if (cause instanceof CanvasApiError && [400, 403, 404, 422].includes(cause.status)) {
        pending.current.delete(id);
        persistPending();
      }
      throw cause;
    }
    });
    runFlights.current.set(id, flight);
    setSubmittingIds([...runFlights.current.keys()]);
    void flight.finally(() => {
      if (runFlights.current.get(id) === flight) runFlights.current.delete(id);
      if (live.current.active) setSubmittingIds([...runFlights.current.keys()]);
    }).catch(() => undefined);
    return flight;
  }, [accept, persistPending, projectId, serialized]);
  const retrySave = useCallback((id: string) => {
    const saved = pendingUpdates.current.get(id);
    if (!saved) return Promise.resolve();
    const { mutationId, expectedRevision, ...input } = saved.input;
    void mutationId; // update reuses the persisted operation identity internally.
    return update(id, input, expectedRevision).then(() => undefined);
  }, [update]);
  return { items, canEdit, loaded, error, refresh, accept, create, update, run, retrySave, get: (id: string) => live.current.items.find(item => item.id === id), hasPending: (id: string) => pendingIds.includes(id), hasPendingSave: (id: string) => pendingUpdateIds.includes(id), isSubmitting: (id: string) => submittingIds.includes(id) };
}
export type CanvasCreationsController = ReturnType<typeof useCanvasCreations>;
