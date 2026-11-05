"use client";

import type { OutfitView, WardrobeRevisionView } from "@fashion/shared";
import { Button, Field, ImagePreview, Input, Notice, Select } from "../../../components/ui";
import { CATEGORY_LABELS, reorderOutfit, type OutfitDraft } from "./wardrobe-state";
import styles from "./wardrobe.module.css";

export function OutfitEditor({ draft, revisions, outfits, dirty, canEdit, busy, canUndo, onChange, onChoose, onUndo, onSave }: {
  draft: OutfitDraft; revisions: Map<string, WardrobeRevisionView>; outfits: OutfitView[];
  dirty: boolean; canEdit: boolean; busy: boolean; canUndo: boolean;
  onChange: (draft: OutfitDraft) => void; onChoose: (id: string) => void; onUndo: () => void; onSave: () => void;
}) {
  return <section className={styles.outfitEditor} aria-label="搭配编辑">
    <header className={styles.sectionHeader}><h3>当前搭配</h3><Button disabled={!canUndo || !canEdit || busy} onClick={onUndo}>撤销</Button></header>
    <Field label="已保存搭配"><Select value={draft.outfitId ?? ""} disabled={busy} onChange={event => onChoose(event.target.value)}><option value="">新建搭配</option>{outfits.map(item => <option key={item.id} value={item.id}>{item.name} 版本 {item.version}</option>)}</Select></Field>
    <Field label="搭配名称"><Input value={draft.name} maxLength={120} disabled={!canEdit || busy} onChange={event => onChange({ ...draft, name: event.target.value })} /></Field>
    <p className={styles.muted}>{draft.items.length} / 12 件单品。列表由内到外排列；调整顺序不会修改单品原图。</p>
    {draft.items.length ? <ol className={styles.outfitList}>{draft.items.map((entry, index) => {
      const item = revisions.get(entry.revisionId);
      return <li key={entry.revisionId} className={styles.outfitItem}>
        <span className={styles.outfitThumbnail}><ImagePreview src={item?.url} alt={item?.name ?? "单品暂不可用"} retryable={false} /></span>
        <div className={styles.outfitDetails}><strong>{item?.name ?? "单品暂不可用"}</strong>{item ? <span className={styles.muted}>{CATEGORY_LABELS[item.category]} 修订 {item.version}</span> : <Notice tone="error">原单品无法读取，请移除后重新选择。</Notice>}
          <Input aria-label={`${item?.name ?? "单品"}的穿着说明`} value={entry.wearNote} maxLength={300} disabled={!canEdit || busy} placeholder="穿着说明（可选）" onChange={event => onChange({ ...draft, items: draft.items.map((current, itemIndex) => itemIndex === index ? { ...current, wearNote: event.target.value } : current) })} />
          <div className={styles.actions}><Button size="small" disabled={!canEdit || busy || index === 0} onClick={() => onChange(reorderOutfit(draft, index, index - 1))} aria-label={`${item?.name ?? "单品"}向内一层`}>向内</Button><Button size="small" disabled={!canEdit || busy || index === draft.items.length - 1} onClick={() => onChange(reorderOutfit(draft, index, index + 1))} aria-label={`${item?.name ?? "单品"}向外一层`}>向外</Button><Button size="small" disabled={!canEdit || busy} onClick={() => onChange({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index).map((current, layer) => ({ ...current, layer })) })} aria-label={`移除${item?.name ?? "单品"}`}>移除</Button></div>
        </div>
      </li>;
    })}</ol> : <p className={styles.emptyOutfit}>从衣架中打开一件单品，选择「加入搭配」。</p>}
    <div className={styles.saveRow}><span role="status">{dirty ? "搭配尚未保存到项目" : draft.outfitId ? `已保存版本 ${draft.version}` : "尚未保存搭配"}</span><Button variant="primary" loading={busy} disabled={!canEdit || !draft.items.length || !draft.name.trim() || !dirty && !!draft.outfitId} onClick={onSave}>{draft.outfitId ? "保存搭配新版本" : "保存搭配"}</Button></div>
  </section>;
}
