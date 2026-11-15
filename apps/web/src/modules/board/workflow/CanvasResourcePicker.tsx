"use client";
/* eslint-disable @next/next/no-img-element -- Authorized project resource previews. */
import { useEffect, useRef, useState } from "react";
import { canvasMediaPayloadSchema, type CanvasCreation, type ProjectGeneratedFile } from "@fashion/shared";
import { WorkflowDialog } from "./WorkflowDialog";
import { fetchGeneratedFiles } from "./generated-files-api";
import { nodeImageUrl } from "./workflow-graph";
import type { WorkflowGraph, WorkflowNode } from "./workflow-api";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./node-entry.module.css";

export type CanvasResourceChoice = { node: WorkflowNode } | { file: ProjectGeneratedFile };
export function CanvasResourcePicker({ projectId, graph, kind, initialTab, onClose, onChoose, onUpload, creations, pending, onRetry }: {
  projectId: string; graph: WorkflowGraph; kind: "all" | "video"; initialTab: "upload" | "existing";
  onClose: () => void; onChoose: (choice: CanvasResourceChoice) => Promise<void>; onUpload: (file: File, signal: AbortSignal, progress: (percent: number) => void) => Promise<void>;
  creations: readonly CanvasCreation[]; pending: boolean; onRetry: () => Promise<unknown>;
}) {
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "image" | "video" | "text">(kind === "video" ? "video" : "all");
  const [files, setFiles] = useState<ProjectGeneratedFile[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadName, setUploadName] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const active = useRef(true), flight = useRef<AbortController | null>(null), lock = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; flight.current?.abort(); }; }, []);
  useEffect(() => {
    if (tab !== "existing") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      void fetchGeneratedFiles(projectId, filter === "text" ? "all" : filter, search, undefined, controller.signal).then(result => { if (controller.signal.aborted) return; setFiles(result.items); setCursor(result.nextCursor); }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "资源载入失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); if (!lock.current) flight.current?.abort(); };
  }, [projectId, filter, search, attempt, tab]);
  const candidates = graph.nodes.filter(node => {
    if (node.kind !== "asset" || node.type === "legacy" || ["pending", "running", "failed", "proposed"].includes(node.status)) return false;
    const owner = creations.find(item => item.id === node.payload.canvasCreationId);
    if (owner && owner.currentResultNodeId !== node.id) return false;
    const media = canvasMediaPayloadSchema.safeParse(node.payload);
    const type = media.success && media.data.mediaKind === "video" ? "video" : nodeImageUrl(node) ? "image" : typeof node.payload.text === "string" && node.payload.text.trim() ? "text" : "other";
    return type !== "other" && (kind !== "video" || type === "video") && (filter === "all" || type === filter) && node.title.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  });
  const rows = [...new Map(candidates.map(node => [String(node.payload.assetId ?? node.payload.mediaId ?? node.id), node])).values()];
  const generated = files.filter(file => ["image", "video"].includes(file.kind) && (kind !== "video" || file.kind === "video") && (filter === "all" || file.kind === filter) && !rows.some(node => node.payload.assetId === file.resourceId || node.payload.mediaId === file.resourceId));
  const choose = async (choice: CanvasResourceChoice) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try { await onChoose(choice); if (active.current) onClose(); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "资源导入未确认，请重试"); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  };
  return <WorkflowDialog label={kind === "video" ? "添加视频" : "添加资源"} onClose={onClose}><section className={styles.resources}>
    <header><h2>{kind === "video" ? "添加视频" : "添加资源"}</h2><button aria-label="关闭资源选择" type="button" onClick={onClose}><WorkspaceIcon name="close" /></button></header>
    <nav aria-label="资源来源"><button disabled={busy} aria-pressed={tab === "upload"} onClick={() => setTab("upload")}>上传</button><button disabled={busy} aria-pressed={tab === "existing"} onClick={() => setTab("existing")}>本项目已有资源</button></nav>
    {error ? <p role="alert">{error}<button onClick={() => setAttempt(value => value + 1)}>重新读取</button></p> : null}
    {pending && !busy ? <p role="status">上一次导入尚未确认。<button onClick={() => { if (lock.current) return; lock.current = true; setBusy(true); void onRetry().then(() => { if (active.current) onClose(); }).catch((cause: unknown) => { if (active.current) setError(cause instanceof Error ? cause.message : "仍未确认"); }).finally(() => { lock.current = false; if (active.current) setBusy(false); }); }}>确认上次导入</button></p> : null}
    {tab === "upload" ? <div className={styles.upload}>
      <WorkspaceIcon name={kind === "video" ? "video" : "image"} /><label>{busy ? "正在导入…" : "选择文件"}<input aria-label="选择上传资源" type="file" multiple={kind === "all"} disabled={busy} accept={kind === "video" ? "video/mp4,video/webm" : "image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/webm"} onChange={event => {
        const selected = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = "";
        if (!selected.length || lock.current) return; lock.current = true; setBusy(true); setError("");
        const controller = new AbortController(); flight.current = controller;
        void (async () => { for (const file of selected) { if (!active.current) return; setUploadName(file.name); setProgress(0); await onUpload(file, controller.signal, value => { if (active.current) setProgress(value); }); } if (active.current) onClose(); })().catch((cause: unknown) => { if (active.current) setError(cause instanceof Error ? cause.message : "导入失败，可重新选择文件继续"); }).finally(() => { lock.current = false; if (active.current) setBusy(false); });
      }} /></label>
      <p>{kind === "video" ? "MP4、WebM，最大100MB" : "图片最大50MB；MP4、WebM视频最大100MB"}</p>
      {busy ? <p role="status">{uploadName}　{progress < 100 ? `${progress}%` : "正在确认文件…"}</p> : null}
    </div> : <>
      <input type="search" disabled={busy} aria-label="搜索已有资源" placeholder="搜索本项目资源" value={search} onChange={event => setSearch(event.target.value)} />
      {kind === "all" ? <nav aria-label="资源类型">{([['all','全部'],['image','图片'],['video','视频'],['text','文本']] as const).map(([value,label]) => <button disabled={busy} key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</nav> : null}
      <div className={styles.resourceGrid}>{rows.map(node => <button key={node.id} disabled={busy} onClick={() => void choose({ node })}>{nodeImageUrl(node) ? <img src={nodeImageUrl(node)} alt="" /> : <WorkspaceIcon name={node.type === "media" ? "video" : "text_edit"} />}<span>{node.title}</span></button>)}{generated.map(file => <button key={file.id} disabled={busy || file.status !== "ready" || Boolean(file.expiresAt && Date.parse(file.expiresAt) <= now)} onClick={() => void choose({ file })}>{file.kind === "image" && file.previewUrl ? <img src={file.previewUrl} alt="" /> : <WorkspaceIcon name={file.kind === "video" ? "video" : "image"} />}<span>{file.title}</span>{file.status !== "ready" ? <small>文件不可用</small> : null}</button>)}</div>
      {loading ? <p role="status">正在读取资源…</p> : !rows.length && !generated.length ? <p>没有匹配的资源</p> : null}
      {cursor ? <button disabled={loading || busy} onClick={() => { const controller = new AbortController(); flight.current = controller; setLoading(true); void fetchGeneratedFiles(projectId, filter === "text" ? "all" : filter, search, cursor, controller.signal).then(result => { if (active.current && !controller.signal.aborted) { setFiles(current => [...current, ...result.items]); setCursor(result.nextCursor); } }).catch((cause: unknown) => { if (active.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取失败"); }).finally(() => { if (active.current && !controller.signal.aborted) setLoading(false); }); }}>读取更多</button> : null}
    </>}
  </section></WorkflowDialog>;
}
