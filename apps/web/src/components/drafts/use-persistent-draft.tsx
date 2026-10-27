"use client";

import { createContext, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DraftConflict, draftRepository, draftWriter, registerDraftDiscard, registerDraftFlush, normalizeDraftBaseline, serializeDraft, type DraftRecord } from "./draft-repository";
import { Button } from "../ui";

export interface DraftScope { accountId: string; projectId: string; editor: string; }
const Scope = createContext<DraftScope | null>(null);
export const useDraftScope = () => useContext(Scope);
const Reports = createContext<((key: string, node: ReactNode) => void) | null>(null);
export function DraftScopeProvider({ scope, children }: { scope: DraftScope | null; children: ReactNode }) {
  const [reports, setReports] = useState<Record<string, ReactNode>>({});
  const report = useCallback((key: string, node: ReactNode) => setReports(current => {
    return node ? { ...current, [key]: node } : Object.fromEntries(Object.entries(current).filter(([id]) => id !== key));
  }), []);
  return <Scope.Provider value={scope}><Reports.Provider value={report}>{children}
    {Object.keys(reports).length ? <aside aria-label="本机草稿恢复" style={{ position: "fixed", bottom: 16, left: 16, maxWidth: "min(480px, calc(100vw - 32px))", maxHeight: "40dvh", overflow: "auto", zIndex: 45, padding: 8, background: "var(--color-paper)", border: "0.5px solid var(--color-border)", borderRadius: 8 }}><details><summary role="button" aria-label="本机草稿状态" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontSize: 12 }}>本机草稿状态{Object.values(reports).some(node => isValidElement<{ draft: { conflict: unknown } }>(node) && node.props.draft.conflict) ? "：有差异待核对" : ""}</summary>{Object.entries(reports).map(([key, node]) => <div key={key}>{node}</div>)}</details></aside> : null}
  </Reports.Provider></Scope.Provider>;
}

export function usePersistentDraft<T>({ value, restore, baseline: serverBaseline, objectKey = "new", enabled = true }: {
  value: T; restore: (value: T) => void; baseline: string; objectKey?: string; enabled?: boolean;
}) {
  const baseline = normalizeDraftBaseline(serverBaseline);
  const scope = useContext(Scope);
  const report = useContext(Reports);
  const key = scope && enabled ? JSON.stringify([scope.accountId, scope.projectId, scope.editor, objectKey]) : "";
  const live = useRef({ value, restore, baseline, key });
  useLayoutEffect(() => { live.current = { value, restore, baseline, key }; }, [value, restore, baseline, key]);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DraftRecord<T> | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const accountId = scope?.accountId;
  const controller = useRef<{ key: string; flush: () => Promise<void>; discard: () => Promise<void>; capture: (value: T, baseline: string) => void; getRevision: () => number; acknowledge: (value: T, expectedRevision?: number) => Promise<void> } | null>(null);
  useEffect(() => {
    if (!key || !accountId) return;
    draftRepository.enableAccount(accountId);
    let active = true;
    let loaded = false;
    let blocked = false;
    let abandoned = false;
    let conflictCopy: DraftRecord<T> | undefined;
    let revision = 0;
    let saved = "";
    let acknowledged = "";
    let base = live.current.baseline;
    let owned = { ...live.current };
    let queue = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const initial = serializeDraft(live.current.value);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("fashion-workspace-drafts");
    const restoreRecord = (record: DraftRecord<T>) => {
      revision = record.revision; saved = serializeDraft(record.value);
      if (record.baseline !== live.current.baseline || serializeDraft(live.current.value) !== initial) {
        blocked = true; setConflict(record); setNotice("本机草稿与当前资料存在差异，请核对后继续。");
      } else {
        base = record.baseline; live.current.restore(record.value); setNotice("已恢复本机草稿，尚未保存到项目。");
      }
    };
    const initialization = Promise.all([draftRepository.read<T>(key), draftRepository.conflicts<T>(key)]).then(([record, copies]) => {
      if (!active) return;
      const cached = draftRepository.memory<T>(key);
      const latest = cached && cached.updatedAt > (record?.updatedAt ?? 0) ? cached : record;
      if (latest) restoreRecord(latest);
      else saved = initial;
      if (copies[0]) { conflictCopy = copies[0]; blocked = true; setConflict(copies[0]); setNotice("另一个版本的本机草稿已保留，请核对差异。"); }
      loaded = true;
    }).catch(() => {
      if (!active) return;
      const cached = draftRepository.memory<T>(key);
      if (cached) restoreRecord(cached);
      loaded = true; setNotice("本机草稿暂未保存，当前内容仅保留在本页。");
    });
    const flush = () => {
      clearTimeout(timer);
      queue = queue.then(async () => {
        await initialization;
        if (!loaded || blocked) return;
        if (live.current.key === key) owned = { ...live.current };
        const signature = serializeDraft(owned.value);
        const currentBase = owned.baseline;
        if (acknowledged && signature === acknowledged) return;
        if (signature === saved && currentBase === base) return;
        // Clean drafts are removed only when the stored version is still ours.
        if (signature === currentBase) {
          if (revision) await draftRepository.remove(key, revision);
          revision = 0; base = currentBase; saved = signature; return;
        }
        if (currentBase !== base) base = currentBase;
        const record = { key, accountId: accountId, value: JSON.parse(signature) as T, baseline: base, revision, updatedAt: Date.now(), writer: draftWriter };
        draftRepository.remember(record);
        try {
          const result = await draftRepository.write(record, revision);
          revision = result.revision; saved = signature;
          channel?.postMessage({ key, writer: draftWriter });
        } catch (error) {
          if (error instanceof DraftConflict) { blocked = true; if (active) { setConflict(error.current as DraftRecord<T>); setNotice("另一个标签页已修改此草稿，本页副本已保留。"); } }
          else if (active) setNotice("本机草稿暂未保存，当前内容仅保留在本页。");
        }
      }).catch(() => { if (active) setNotice("本机草稿暂未保存，当前内容仅保留在本页。"); });
      return queue;
    };
    const change = () => { clearTimeout(timer); timer = setTimeout(() => void flush(), 300); };
    const hidden = () => { if (document.hidden) void flush(); };
    const remote = async (event: MessageEvent<{ key: string; writer: string }>) => {
      if (event.data.key !== key || event.data.writer === draftWriter) return;
      const record = await draftRepository.read<T>(key).catch(() => undefined);
      if (record && active) { blocked = true; setConflict(record); setNotice("此草稿已在另一个标签页更新，请核对差异。"); }
    };
    if (channel) channel.onmessage = event => { void remote(event); };
    const discard = async () => {
      await queue;
      const current = await draftRepository.read<T>(key).catch(() => undefined);
      if (current) await draftRepository.remove(key, current.revision);
      if (conflictCopy) await draftRepository.remove(conflictCopy.key, conflictCopy.revision);
      const ownCopy = await draftRepository.read<T>(`${key}:conflict:${draftWriter}`).catch(() => undefined);
      if (ownCopy) await draftRepository.remove(ownCopy.key, ownCopy.revision);
      conflictCopy = undefined;
      blocked = false; revision = 0; base = live.current.baseline; saved = "";
      setConflict(null); setNotice(null); setShowDiff(false);
    };
    const acknowledge = async (submitted: T, expectedRevision?: number) => {
      const signature = serializeDraft(submitted);
      acknowledged = (expectedRevision === undefined || revision === expectedRevision) && serializeDraft(owned.value) === signature ? signature : "";
      await queue;
      const current = await draftRepository.read<T>(key).catch(() => undefined);
      if (current?.writer === draftWriter && (expectedRevision === undefined || current.revision === expectedRevision) && serializeDraft(current.value) === signature) {
        try { if (await draftRepository.remove(key, current.revision)) { revision = 0; saved = signature; } }
        catch { if (active) setNotice("本机草稿暂未保存，当前内容仅保留在本页。"); }
      }
    };
    controller.current = { key, acknowledge, getRevision: () => revision, capture: (value, baseline) => { if (acknowledged && serializeDraft(value) !== acknowledged) acknowledged = ""; owned = { ...owned, value, baseline }; if (abandoned && serializeDraft(value) === baseline) { abandoned = false; blocked = false; saved = baseline; base = baseline; } }, flush: async () => { change(); await flush(); }, discard };
    const unregister = registerDraftFlush(flush);
    const unregisterDiscard = registerDraftDiscard(key, async () => {
      await queue;
      // Delete only this tab's revision; preserve another editor's newer draft.
      blocked = true; abandoned = true;
      if (revision) await draftRepository.remove(key, revision).catch(() => false);
      revision = 0;
      live.current.restore(JSON.parse(live.current.baseline) as T);
    });
    document.addEventListener("visibilitychange", hidden);
    return () => {
      void flush(); active = false; clearTimeout(timer); unregister(); unregisterDiscard(); channel?.close();
      document.removeEventListener("visibilitychange", hidden);
      if (controller.current?.key === key) controller.current = null;
    };
  }, [key, accountId]);
  useLayoutEffect(() => { if (controller.current?.key === key) controller.current.capture(value, baseline); }, [key, value, baseline]);
  const signature = serializeDraft(value);
  useEffect(() => {
    if (signature === baseline) { void controller.current?.flush(); return; }
    const timer = setTimeout(() => { void controller.current?.flush(); }, 300);
    return () => clearTimeout(timer);
  }, [signature, baseline, key]);
  const result = useMemo(() => ({
    notice, conflict, showDiff, setShowDiff,
    dismiss: () => setNotice(null),
    acknowledge: (submitted: T) => controller.current?.key === key ? controller.current.acknowledge(submitted) : undefined,
    captureAcknowledgement: async (submitted: T) => {
      const owner = controller.current;
      if (!owner || owner.key !== key) return async () => {};
      await owner.flush();
      const revision = owner.getRevision();
      return () => owner.acknowledge(submitted, revision);
    },
    discard: () => controller.current?.discard(),
    useServer: async () => { await controller.current?.discard(); live.current.restore(JSON.parse(live.current.baseline) as T); },
    useLocal: async () => { const record = conflict; await controller.current?.discard(); if (record) live.current.restore(record.value); },
    continueEditing: async () => { await controller.current?.discard(); await controller.current?.flush(); },
  }), [notice, conflict, showDiff, key]);
  const node = useMemo(() => notice ? <DraftRecoveryNotice draft={result} current={JSON.parse(signature) as T} /> : null, [notice, result, signature]);
  useEffect(() => { if (key) report?.(key, node); return () => { if (key) report?.(key, null); }; }, [key, node, report]);
  return result;
}

export function DraftRecoveryNotice<T>({ draft, current }: { draft: ReturnType<typeof usePersistentDraft<T>>; current: T }) {
  if (!draft.notice) return null;
  return <section role="status" data-draft-recovery style={{ marginBlock: 8, fontSize: 12 }}>
    <span>{draft.notice}</span>
    {draft.conflict ? <>
      <Button size="small" onClick={() => draft.setShowDiff(!draft.showDiff)}>查看差异</Button>
      <Button size="small" onClick={() => void draft.useServer()}>采用服务端版本</Button>
      <Button size="small" onClick={() => void draft.useLocal()}>恢复另一份草稿</Button>
      <Button size="small" onClick={() => void draft.continueEditing()}>保留本页并继续合并</Button>
      {draft.showDiff ? <div style={{ display: "grid", gap: 8, overflow: "auto", maxHeight: 240 }}><pre>本页：{serializeDraft(current)}</pre><pre>草稿：{serializeDraft(draft.conflict.value)}</pre></div> : null}
    </> : <Button size="small" onClick={draft.dismiss}>知道了</Button>}
  </section>;
}
