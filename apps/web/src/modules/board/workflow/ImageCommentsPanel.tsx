"use client";

import type { RefObject } from "react";
import type { ImageFeedback } from "@fashion/shared";
import styles from "./image-workspace.module.css";

export interface ImageCommentDraft {
  text: string;
  point: { x: number; y: number } | null;
  editingId: string | null;
  annotationIds: string[];
}

export function ImageCommentsPanel({
  feedback, draft, selected, locked, inputRef, onDraft, onSelect, onEdit,
  onDelete, onClear, onAdd, onSave, onSubmit,
  onPrepareAssistant,
}: {
  feedback: ImageFeedback;
  draft: ImageCommentDraft;
  selected: string[];
  locked: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onDraft: (value: Partial<ImageCommentDraft>) => void;
  onSelect: (ids: string[]) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onAdd: () => void;
  onSave: () => void;
  onSubmit: () => void;
  onPrepareAssistant: (() => void) | undefined;
}) {
  const number = draft.editingId ? feedback.comments.findIndex(c => c.id === draft.editingId) + 1 : feedback.comments.length + 1;
  const composing = Boolean(draft.text || draft.point || draft.editingId || draft.annotationIds.length);
  const full = !draft.editingId && feedback.comments.length >= 100;
  return <>
    <p>点一下图片，告诉织芽哪里需要调整。也可以写下整图意见。</p>
    <fieldset className={styles.commentComposer} disabled={locked}>
      <legend>{draft.editingId ? `编辑意见 ${number}` : "新增修改意见"}</legend>
      <div className={styles.row}>
        <span>{draft.point ? `标记 ${number} · 点击图片可重新定位` : "整张图片"}</span>
        <button type="button" onClick={() => onDraft({ point: draft.point ? null : { x: .5, y: .5 } })} disabled={full}>
          {draft.point ? "改为整图" : "定位到图片中心"}
        </button>
      </div>
      <label>
        修改内容
        <textarea ref={inputRef} aria-label="图片评论" maxLength={2000} value={draft.text}
          onChange={e => onDraft({ text: e.target.value })}
          placeholder="例如：保留面料，将袖口收窄" />
      </label>
      {feedback.annotations.length ? <details className={styles.commentLinks}>
        <summary>附上画面标注{draft.annotationIds.length ? `（${draft.annotationIds.length}）` : "（可选）"}</summary>
        <p>只勾选与这条意见有关的标注。</p>
        {feedback.annotations.map((a, i) => <label key={a.id}>
          <input type="checkbox" checked={draft.annotationIds.includes(a.id)}
            onChange={e => onDraft({ annotationIds: e.target.checked ? [...draft.annotationIds, a.id] : draft.annotationIds.filter(id => id !== a.id) })} />
          标注 {i + 1} · {{ pen: "画笔", rectangle: "矩形", arrow: "箭头", text: "文字" }[a.kind]}
        </label>)}
      </details> : null}
      <div className={styles.row}>
        <button type="button" disabled={!draft.text.trim() || full} onClick={onAdd}>{draft.editingId ? "更新评论" : "添加评论"}</button>
        {composing ? <button type="button" onClick={onClear}>{draft.editingId ? "取消编辑" : "清空草稿"}</button> : null}
      </div>
      {full ? <p>已达到 100 条意见，可以编辑或删除已有意见。</p> : null}
    </fieldset>
    {feedback.comments.length ? <>
      <div className={styles.row}><strong>本轮修改意见</strong><span>已选 {selected.length} / {feedback.comments.length}</span></div>
      <ol className={styles.commentList} aria-label="修改意见列表">
        {feedback.comments.map((c, i) => <li className={styles.comment} key={c.id} data-editing={draft.editingId === c.id}>
          <label>
            <input type="checkbox" aria-label={`选择意见 ${i + 1}`} disabled={locked} checked={selected.includes(c.id)}
              onChange={e => onSelect(e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id))} />
            <span><strong>{i + 1} · {c.point ? "图片位置" : "整张图片"}</strong><span className={styles.commentText}>{c.text}</span></span>
          </label>
          <div className={styles.commentActions}>
            <button type="button" disabled={locked} aria-label={`编辑意见 ${i + 1}`} onClick={() => onEdit(c.id)}>编辑</button>
            <button type="button" disabled={locked} aria-label={`删除意见 ${i + 1}`} onClick={() => onDelete(c.id)}>删除</button>
          </div>
        </li>)}
      </ol>
    </> : <p>添加意见后，勾选这次想修改的内容，再交给织芽。</p>}
    <div className={styles.commentSubmit}>
      {composing ? <p>先{draft.editingId ? "更新" : "添加"}这条意见，或取消草稿，再提交修改。</p> : null}
      <button type="button" disabled={locked || composing} onClick={onSave}>保存评论</button>
      {onPrepareAssistant ? <>
        <p className={styles.handoffHint}>保存后打开同一设计助手，先整理修订计划，不会自动生成。</p>
        <button type="button" className={styles.assistantHandoff} disabled={locked || !selected.length || composing} onClick={onPrepareAssistant}>
          交给设计助手制定修订计划
        </button>
      </> : null}
      <button type="button" className={styles.primary} disabled={locked || !selected.length || composing} onClick={onSubmit}>按选中意见修改</button>
    </div>
  </>;
}
