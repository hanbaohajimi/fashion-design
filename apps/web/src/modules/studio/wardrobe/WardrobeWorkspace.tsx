"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StudioSummary, WardrobeItemView, WardrobeRevisionView, WardrobeSummary } from "@fashion/shared";
import { Button, Dialog, Notice, SegmentedControl } from "../../../components/ui";
import { WorkspaceSplit } from "../../../components/WorkspaceSplit";
import { usePersistentDraft } from "../../../components/drafts/use-persistent-draft";
import { userFacingError } from "../../../components/user-facing-error";
import { useWardrobeData } from "./use-wardrobe-data";
import { wardrobeApi, WardrobeApiError } from "./wardrobe-api";
import { addToOutfit, categoriesConflict, emptyOutfit, outfitDraft, outfitIsCurrent, type OutfitDraft } from "./wardrobe-state";
import { WardrobeRack } from "./WardrobeRack";
import { OutfitEditor } from "./OutfitEditor";
import { PrepareGarment } from "./PrepareGarment";
import { WardrobeTryOn } from "./WardrobeTryOn";
import styles from "./wardrobe.module.css";

export interface WardrobeWorkspaceProps {
  projectId: string; assets: StudioSummary["assets"]; styles?: StudioSummary["styles"] | undefined;
  canEdit: boolean; initialAssetId?: string | undefined; initialStyleRevisionId?: string | undefined;
  onSaved?: (() => void | Promise<void>) | undefined; onDirty?: ((dirty: boolean) => void) | undefined;
}

export function WardrobeWorkspace(props: WardrobeWorkspaceProps) {
  return <WardrobeLoader key={props.projectId} {...props} />;
}

function WardrobeLoader(props: WardrobeWorkspaceProps) {
  const { data, loading, error, refresh } = useWardrobeData(props.projectId);
  return <div className={styles.root}>
    {error ? <Notice tone="error">衣架资料暂时无法更新：{error}<Button onClick={() => void refresh()}>重新读取</Button></Notice> : null}
    {data ? <WardrobeContent {...props} data={data} refresh={refresh} /> : <p role="status">{loading ? "正在读取项目衣架…" : "项目衣架尚未读取，请重试。"}</p>}
  </div>;
}

function WardrobeContent({ projectId, assets, styles: projectStyles, canEdit: permitted, initialAssetId, initialStyleRevisionId, onSaved, onDirty, data, refresh }: WardrobeWorkspaceProps & { data: WardrobeSummary; refresh: () => Promise<void> }) {
  const canEdit = permitted && data.canEdit && data.capabilities.enabled;
  const [draft, setDraft] = useState<OutfitDraft>(() => data.outfits[0] ? outfitDraft(data.outfits[0]) : emptyOutfit());
  const [baseline, setBaseline] = useState(() => JSON.stringify(draft));
  const [undo, setUndo] = useState<OutfitDraft[]>([]);
  const [open, setOpen] = useState(true);
  const [docked, setDocked] = useState(false);
  const [measured, setMeasured] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [mobileView, setMobileView] = useState<"rack" | "outfit" | "tryon">("rack");
  const [prepare, setPrepare] = useState(Boolean(initialAssetId || initialStyleRevisionId));
  const [editingItem, setEditingItem] = useState<WardrobeItemView | null>(null);
  const [adding, setAdding] = useState<WardrobeRevisionView | null>(null);
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selfDirty, setSelfDirty] = useState(false);
  const locked = useRef(false);
  const packet = useRef<{ signature: string; key: string } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  const recovery = usePersistentDraft({ value: draft, restore: setDraft, baseline, objectKey: "wardrobe-outfit", enabled: canEdit });
  const saved = data.outfits.find(item => item.id === draft.outfitId);
  const snapshot = saved?.currentSnapshot ?? null;
  const revisionMap = new Map<string, WardrobeRevisionView>(data.items.flatMap(item => [...item.revisions, item.currentRevision].map(revision => [revision.id, revision] as const)));
  for (const outfit of data.outfits) for (const version of outfit.snapshots) for (const item of version.items) if (!revisionMap.has(item.id)) revisionMap.set(item.id, item);
  const conflicts = adding ? draft.items.filter(entry => { const existing = revisionMap.get(entry.revisionId); return existing && (existing.itemId === adding.itemId || categoriesConflict(existing.category, adding.category)); }) : [];
  useEffect(() => { onDirty?.(dirty || selfDirty); return () => onDirty?.(false); }, [dirty, selfDirty, onDirty]);
  useLayoutEffect(() => {
    if (!host.current) return;
    const measure = () => { setDocked((host.current?.getBoundingClientRect().width ?? 0) >= 966); setMobile(window.matchMedia("(max-width: 767px)").matches); setMeasured(true); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  const changed = useCallback(async () => { await refresh(); await onSaved?.(); }, [refresh, onSaved]);
  const changePanelOpen = (value: boolean) => { setOpen(value); if (mobile && !value) setMobileView("rack"); };
  const change = (next: OutfitDraft) => {
    if (!canEdit || busy || next === draft) return;
    setUndo(history => [...history.slice(-39), draft]); setDraft(next); setMessage(null); setError(null);
  };
  const undoLast = () => { const previous = undo.at(-1); if (previous) { setDraft(previous); setUndo(history => history.slice(0, -1)); setMessage(null); } };
  const add = (item: WardrobeRevisionView, replaceIds: string[] = [], layering = false) => {
    try { change(addToOutfit({ ...draft, layeringConfirmed: draft.layeringConfirmed || layering }, item, replaceIds)); setMessage(replaceIds.length ? `已用「${item.name}」替换 ${replaceIds.length} 件相同穿着位置的单品。` : `已将「${item.name}」${layering ? "叠穿" : "加入"}到当前搭配。`); setAdding(null); setOpen(true); } catch (cause) { setError(userFacingError(cause)); }
  };
  const choose = (id: string) => {
    const outfit = data.outfits.find(item => item.id === id);
    const value = outfit ? outfitDraft(outfit) : emptyOutfit();
    setDraft(value); setBaseline(JSON.stringify(value)); setUndo([]); setSwitchTo(null); packet.current = null;
  };
  const save = async () => {
    if (locked.current || !canEdit || !draft.items.length) return false;
    locked.current = true; setBusy(true); setError(null);
    const submitted = draft;
    const signature = JSON.stringify(submitted);
    if (packet.current?.signature !== signature) packet.current = { signature, key: crypto.randomUUID() };
    try {
      const acknowledge = await recovery.captureAcknowledgement(submitted);
      const result = await wardrobeApi.save(projectId, { requestKey: packet.current.key, name: submitted.name, items: submitted.items, layeringConfirmed: submitted.layeringConfirmed, ...(submitted.outfitId ? { outfitId: submitted.outfitId, expectedVersion: submitted.version ?? 1 } : {}) });
      await acknowledge();
      const next = outfitDraft(result); setDraft(next); setBaseline(JSON.stringify(next)); setUndo([]); packet.current = null;
      setMessage(`已保存「${result.name}」版本 ${result.version}`); await changed(); return true;
    } catch (cause) {
      setError(cause instanceof WardrobeApiError && cause.status === 409 ? "此搭配已有新版本。当前草稿已保留，请重新读取后核对，再另存搭配或合并。" : userFacingError(cause)); return false;
    } finally { locked.current = false; setBusy(false); }
  };
  return <div ref={host} className={styles.workspace}>
    <header className={styles.toolbar}><div><h2>衣架与搭配</h2><p>当前项目的单品陈列，点击服装聚焦查看。</p></div><div className={styles.actions}><Button disabled={!canEdit} onClick={() => { setEditingItem(null); setPrepare(true); }}>准备单品</Button>{!mobile ? <Button aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起搭配面板" : "打开搭配面板"}</Button> : null}</div></header>
    {!data.capabilities.enabled ? <Notice>衣架功能当前未启用，已有资料仍可查看。</Notice> : null}
    {error ? <Notice tone="error" onClose={() => setError(null)}>{error}<Button onClick={() => void refresh()}>重新读取</Button>{draft.outfitId ? <Button onClick={() => change({ ...draft, outfitId: null, version: null, name: `${draft.name} 副本`.slice(0, 120) })}>将草稿另存为新搭配</Button> : null}</Notice> : null}
    {message ? <Notice onClose={() => setMessage(null)}>{message}</Notice> : null}
    {mobile ? <SegmentedControl label="衣架工作视图" value={mobileView} options={[{ value: "rack", label: "衣架" }, { value: "outfit", label: "搭配" }, { value: "tryon", label: "试穿" }]} onChange={value => { setMobileView(value); setOpen(value !== "rack"); }} /> : null}
    {measured ? <WorkspaceSplit className={styles.split} projectId={`wardrobe:${projectId}`} panelLabel="搭配与试衣面板" docked={docked} open={open} onOpenChange={changePanelOpen}>
      <div className={styles.rackPane} hidden={mobile && mobileView !== "rack"}><WardrobeRack projectId={projectId} items={data.items} canEdit={canEdit && !busy} initialAssetId={initialAssetId} selectedRevisionIds={draft.items.map(item => item.revisionId)} additionNotice={message} additionError={error} onUndo={undo.length ? undoLast : undefined} layeringItemIds={data.items.filter(item => !draft.items.some(entry => revisionMap.get(entry.revisionId)?.itemId === item.id) && draft.items.some(entry => { const previous = revisionMap.get(entry.revisionId); return previous && categoriesConflict(previous.category, item.currentRevision.category); })).map(item => item.id)} onLayer={setAdding} onPrepare={() => { setEditingItem(null); setPrepare(true); }} onRevise={item => { setEditingItem(item); setPrepare(true); }} onAdd={item => {
        if (draft.items.some(entry => entry.revisionId === item.id)) { setMessage("这件单品已在当前搭配中。"); return; }
        const replace = draft.items.filter(entry => { const existing = revisionMap.get(entry.revisionId); return existing && (existing.itemId === item.itemId || categoriesConflict(existing.category, item.category)); });
        add(item, replace.map(entry => entry.revisionId));
      }} onArchive={(item, archived) => {
        if (locked.current || !canEdit) return;
        locked.current = true; setBusy(true);
        void wardrobeApi.archive(projectId, item, archived).then(changed).catch(cause => setError(userFacingError(cause))).finally(() => { locked.current = false; setBusy(false); });
      }} /></div>
      <aside className={styles.sidebar} aria-label="搭配与试衣面板" hidden={!open || mobile && mobileView === "rack"}>
        <header className={styles.panelHeader}><h2>搭配与试衣</h2><Button onClick={() => changePanelOpen(false)}>收起</Button></header>
        <div hidden={mobile && mobileView !== "outfit"}><OutfitEditor draft={draft} revisions={revisionMap} outfits={data.outfits} dirty={dirty} canEdit={canEdit} busy={busy} canUndo={undo.length > 0} onChange={change} onChoose={id => { if (dirty) setSwitchTo(id); else choose(id); }} onUndo={undoLast} onSave={() => void save()} /></div>
        <div hidden={mobile && mobileView !== "tryon"}><WardrobeTryOn projectId={projectId} assets={assets} data={data} snapshot={snapshot} draft={draft} revisions={revisionMap} dirty={dirty || !outfitIsCurrent(draft, saved)} canEdit={canEdit} onChanged={changed} onDirty={setSelfDirty} /></div>
      </aside>
    </WorkspaceSplit> : null}
    {prepare ? <PrepareGarment key={editingItem?.id ?? "new"} projectId={projectId} assets={assets} styles={projectStyles} preparations={data.preparations} canEdit={canEdit} generationEnabled={data.capabilities.preparationEnabled} initialAssetId={initialAssetId} initialStyleRevisionId={initialStyleRevisionId} existingItem={editingItem} onChanged={changed} onClose={() => setPrepare(false)} /> : null}
    {adding ? <Dialog label="选择同类单品的搭配方式" onClose={() => setAdding(null)}><h3>如何加入「{adding.name}」？</h3><p>当前搭配已有相同穿着位置的单品。可以替换已有单品，也可以明确保留并叠穿。同一件单品的不同修订只能保留一个。</p><div className={styles.actions}><Button variant="primary" onClick={() => add(adding, conflicts.map(item => item.revisionId))}>替换同类单品</Button><Button disabled={conflicts.some(entry => revisionMap.get(entry.revisionId)?.itemId === adding.itemId)} onClick={() => add(adding, [], true)}>保留并叠穿</Button><Button onClick={() => setAdding(null)}>取消</Button></div></Dialog> : null}
    {switchTo !== null ? <Dialog label="切换搭配前保存" onClose={() => setSwitchTo(null)}><h3>当前搭配尚未保存</h3><p>保存后切换，或明确放弃本次修改。</p><div className={styles.actions}><Button variant="primary" loading={busy} disabled={!draft.items.length} onClick={() => { const next = switchTo; void save().then(ok => { if (ok) choose(next); }); }}>保存后切换</Button><Button disabled={busy} onClick={() => { void Promise.resolve(recovery.discard()).then(() => choose(switchTo)); }}>放弃修改并切换</Button><Button onClick={() => setSwitchTo(null)}>继续编辑</Button></div></Dialog> : null}
  </div>;
}
