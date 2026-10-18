"use client";

import { useState } from "react";
import type { WorkflowAssetType } from "./workflow-api";
import { WorkflowDialog } from "./WorkflowDialog";
import styles from "./workflow-canvas.module.css";

interface LibraryItem {
  readonly id: string;
  readonly imageUrl: string | null;
  readonly label: string;
  readonly summary: string;
  readonly sourceUrl?: string;
}

export function WorkflowMaterialEntry({ type, initialTitle, busy, onAdd, onClose }: {
  readonly type: WorkflowAssetType;
  readonly initialTitle: string;
  readonly busy: boolean;
  readonly onAdd: (title: string, payload: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState("");
  const [color, setColor] = useState("#40536D");
  const [error, setError] = useState<string | null>(null);
  return <WorkflowDialog label={`添加${initialTitle}`} onClose={onClose} returnFocusSelector="[data-material-trigger]">
    <form className={styles.entryDialog} onSubmit={(event) => {
      event.preventDefault();
      if (!title.trim() || busy) return;
      void onAdd(title.trim(), { text: text.trim(), ...(type === "swatch" ? { color } : {}) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "素材保存失败"));
    }}>
      <header><span className={styles.overline}>添加设计素材</span><button aria-label="关闭" onClick={onClose} type="button">×</button></header>
      <h2>{initialTitle}</h2>
      <label>名称<input autoFocus maxLength={200} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
      {type === "swatch" ? <label>色号<input onChange={(event) => setColor(event.target.value)} type="color" value={color} /></label> : null}
      <label>内容<textarea maxLength={4000} onChange={(event) => setText(event.target.value)} placeholder="写下设计目标、场景或参考说明…" rows={5} value={text} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy} type="submit">加入工作流</button>
    </form>
  </WorkflowDialog>;
}

export function WorkflowLibraryDialog({ kind, items, loading, onAdd, onClose }: {
  readonly kind: "fabric" | "trend";
  readonly items: readonly LibraryItem[];
  readonly loading: boolean;
  readonly onAdd: (item: LibraryItem) => Promise<void>;
  readonly onClose: () => void;
}) {
  const label = kind === "trend" ? "选择趋势" : "选择面料";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <WorkflowDialog label={label} onClose={onClose} returnFocusSelector="[data-material-trigger]">
    <section aria-label={label} className={styles.libraryDialog}>
      <header><h2>{label}参考</h2><button aria-label="关闭" onClick={onClose} type="button">×</button></header>
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.libraryGrid}>{loading ? <p>正在读取资料库…</p> : items.length === 0 ? <p>资料库暂无可用素材。</p> : items.map((item) => (
        <button disabled={saving} key={item.id} onClick={() => {
          setSaving(true);
          void onAdd(item).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "素材添加失败")).finally(() => setSaving(false));
        }} type="button">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={item.label} src={item.imageUrl} />
          ) : <span className={styles.libraryPlaceholder}>◇</span>}
          <strong>{item.label}</strong><small>{item.summary}</small>
        </button>
      ))}</div>
    </section>
  </WorkflowDialog>;
}
