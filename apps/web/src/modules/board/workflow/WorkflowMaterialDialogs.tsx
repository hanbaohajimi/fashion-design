"use client";

import { readSwatchColors } from "@fashion/shared";
import { useEffect, useState } from "react";
import { privateFetch } from "../../auth/private-fetch";
import type { WorkflowAssetType } from "./workflow-api";
import { WorkflowDialog } from "./WorkflowDialog";
import { Button, Field, Input, Select } from "../../../components/ui";
import styles from "./workflow-canvas.module.css";

interface LibraryItem {
  readonly id: string;
  readonly imageUrl: string | null;
  readonly label: string;
  readonly summary: string;
  readonly sourceUrl?: string;
}

export function WorkflowMaterialEntry({ type, initialTitle, initialPayload, busy, onAdd, onClose }: {
  readonly type: WorkflowAssetType;
  readonly initialTitle: string;
  readonly initialPayload?: Readonly<Record<string, unknown>>;
  readonly busy: boolean;
  readonly onAdd: (title: string, payload: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [text, setText] = useState(typeof initialPayload?.text === "string" ? initialPayload.text : "");
  const [colors, setColors] = useState(() => initialPayload ? readSwatchColors(initialPayload, initialTitle) : [{ hex: "#40536D", name: "色彩 1" }]);
  const [error, setError] = useState<string | null>(null);
  return <WorkflowDialog label={`添加${initialTitle}`} onClose={onClose} returnFocusSelector="[data-material-trigger]">
    <form className={styles.entryDialog} onSubmit={(event) => {
      event.preventDefault();
      if (!title.trim() || busy) return;
      void onAdd(title.trim(), { text: text.trim(), ...(type === "swatch" ? { color: colors[0]?.hex, colors } : {}) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "素材保存失败"));
    }}>
      <header><span className={styles.overline}>添加设计素材</span><button aria-label="关闭" onClick={onClose} type="button">×</button></header>
      <h2>{initialTitle}</h2>
      <label>名称<input autoFocus maxLength={200} onChange={(event) => setTitle(event.target.value)} required value={title} /></label>
      {type === "swatch" ? <fieldset><legend>色卡（最多12色）</legend>{colors.map((color, index) => <div key={index}><input aria-label={`色号 ${index + 1}`} type="color" value={color.hex} onChange={e => setColors(colors.map((c, i) => i === index ? { ...c, hex: e.target.value } : c))} /><input aria-label={`颜色名称 ${index + 1}`} maxLength={48} required value={color.name} onChange={e => setColors(colors.map((c, i) => i === index ? { ...c, name: e.target.value } : c))} /><button type="button" disabled={index === 0} onClick={() => { const next = [...colors]; const previous = next[index - 1]; const current = next[index]; if (previous && current) { next[index - 1] = current; next[index] = previous; setColors(next); } }}>上移</button><button type="button" disabled={colors.length === 1} onClick={() => setColors(colors.filter((_, i) => i !== index))}>删除</button></div>)}<button type="button" disabled={colors.length >= 12} onClick={() => setColors([...colors, { hex: "#40536D", name: `色彩 ${colors.length + 1}` }])}>添加颜色</button></fieldset> : null}
      <label>内容<textarea maxLength={4000} onChange={(event) => setText(event.target.value)} placeholder="写下设计目标、场景或参考说明…" rows={5} value={text} /></label>
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy} type="submit">加入工作流</button>
    </form>
  </WorkflowDialog>;
}

export function WorkflowLibraryDialog({ kind, onAdd, onClose }: {
  readonly kind: "fabric" | "trend";
  readonly onAdd: (item: LibraryItem) => Promise<void>;
  readonly onClose: () => void;
}) {
  const label = kind === "trend" ? "选择趋势" : "选择面料";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("all");
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState({ search: "", scope: "all" });
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: "30", ...(kind === "fabric" ? query : {}) });
    void privateFetch(`/api/${kind === "fabric" ? "fabrics" : "trends"}?${params}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("资料库读取失败，请重试");
        const data = await response.json() as { items: Record<string, unknown>[]; hasMore?: boolean; total?: number; totalPages?: number };
        controller.signal.throwIfAborted();
        const next = data.items.map((item): LibraryItem => ({ id: String(item.id), imageUrl: typeof item.coverImageUrl === "string" ? item.coverImageUrl : typeof item.mainImageUrl === "string" ? item.mainImageUrl : null,
          label: kind === "trend" ? String(item.title ?? "趋势") : Array.isArray(item.tags) ? item.tags.join(" · ") : "面料参考",
          summary: kind === "trend" ? String(item.summary ?? "") : "", ...(typeof item.sourceUrl === "string" ? { sourceUrl: item.sourceUrl } : {}) }));
        setItems((current) => page === 1 ? next : [...current, ...next.filter((item) => !current.some((old) => old.id === item.id))]);
        setHasMore(data.hasMore ?? (data.total !== undefined ? page * 30 < data.total : page < (data.totalPages ?? 1)));
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "资料库读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [kind, page, query, retry]);
  return <WorkflowDialog label={label} onClose={onClose} returnFocusSelector="[data-material-trigger]">
    <section aria-label={label} className={styles.libraryDialog}>
      <header><h2>{label}参考</h2><button aria-label="关闭" onClick={onClose} type="button">×</button></header>
      {kind === "fabric" ? <form onSubmit={(event) => { event.preventDefault(); setLoading(true); setLoadError(null); setItems([]); setPage(1); setQuery({ search, scope }); }}>
        <Field label="搜索面料"><Input value={search} onChange={(event) => setSearch(event.target.value)} /></Field>
        <Field label="范围"><Select value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">全部面料</option><option value="preset">预置面料</option><option value="user">我的面料</option></Select></Field>
        <Button type="submit">搜索</Button>
      </form> : null}
      {error ? <p role="alert">{error}</p> : null}
      {loadError ? <p role="alert">{loadError}<button onClick={() => { setLoading(true); setLoadError(null); setRetry((value) => value + 1); }} type="button">重试读取</button></p> : null}
      {loading ? <p role="status">正在读取资料库…</p> : null}
      <div className={styles.libraryGrid}>{!loading && !loadError && items.length === 0 ? <p>资料库暂无可用素材。</p> : items.map((item) => (
        <button disabled={saving} key={item.id} onClick={() => {
          setSaving(true);
          void onAdd(item).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "素材添加失败")).finally(() => setSaving(false));
        }} type="button">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={item.label} src={item.imageUrl} />
          ) : <span aria-hidden="true" className={styles.libraryPlaceholder}>◇</span>}
          <strong>{item.label}</strong><small>{item.summary}</small>
        </button>
      ))}</div>
      {!loadError && hasMore ? <button disabled={loading} onClick={() => { setLoading(true); setPage((value) => value + 1); }} type="button">加载更多</button> : !loading && !loadError && items.length > 0 ? <p>已全部加载</p> : null}
    </section>
  </WorkflowDialog>;
}
