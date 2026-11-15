"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { GeneratedFileFilter, ProjectGeneratedFile } from "@fashion/shared";
import { Dialog, ImagePreview } from "../../../components/ui";
import { useAuth } from "../../auth/AuthProvider";
import { DesignPathPanel } from "../generation/DesignPathPanel";
import { downloadGeneratedFile, fetchGeneratedFiles, generatedFileSize } from "./generated-files-api";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./generated-files.module.css";
import { useGeneratedFilePlacement } from "./use-generated-file-placement";
import type { runCanvasCommand } from "./canvas-api";

const filters: readonly [GeneratedFileFilter, string][] = [["all", "全部"], ["image", "图片"], ["video", "视频"], ["audio", "音频"], ["document", "文档"]];
const kindLabels = { image: "图片", video: "视频", audio: "音频", document: "文档" };
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
type Props = {
  projectId: string; onClose: () => void; onLocate: (nodeId: string) => boolean;
  canPlace?: boolean;
  isPlaced?: (resourceId: string, domain?: "asset" | "runway") => boolean;
  onPreparePlacement?: () => Promise<{ x: number; y: number }>;
  onPlaced?: (result: Awaited<ReturnType<typeof runCanvasCommand>>) => Promise<void>;
};

export function GeneratedFilesPanel(props: Props) {
  const { session } = useAuth();
  return session ? <GeneratedFilesContent key={`${session.user.id}:${props.projectId}`} {...props} accountId={session.user.id} /> : null;
}

function GeneratedFilesContent({ projectId, accountId, onClose, onLocate, canPlace = false, isPlaced, onPreparePlacement, onPlaced }: Props & { accountId: string }) {
  const [kind, setKind] = useState<GeneratedFileFilter>("all");
  const [search, setSearch] = useState("");
  const [q, setQuery] = useState("");
  const [selected, setSelected] = useState<ProjectGeneratedFile | null>(null);
  const [pathOpen, setPathOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [placementPreparing, setPlacementPreparing] = useState(false);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [placedNode, setPlacedNode] = useState<string | null>(null);
  const [placedMedia, setPlacedMedia] = useState(false);
  const [placedFiles, setPlacedFiles] = useState<ReadonlyMap<string, string>>(new Map());
  const placementLock = useRef(false);
  const placement = useGeneratedFilePlacement(projectId, async result => {
    if (!onPlaced) throw new Error("当前白板尚未就绪，请返回后重试。");
    await onPlaced(result);
    setPlacedMedia(result.graph.nodes.some(node => node.id === result.nodeId && node.type === "media"));
    setPlacedNode(result.nodeId); setNotice("已放入白板，可关闭列表继续编辑。");
  });
  const flight = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const active = useRef(true);
  const query = useInfiniteQuery({
    queryKey: ["project-generated-files", accountId, projectId, kind, q],
    queryFn: ({ pageParam, signal }) => fetchGeneratedFiles(projectId, kind, q, pageParam, signal),
    initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor ?? undefined,
    staleTime: 0, retry: false, refetchOnWindowFocus: false, gcTime: 0,
  });
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { if (list.current) list.current.scrollTop = 0; }, [kind, q]);
  useEffect(() => {
    active.current = true;
    const cancel = () => { flight.current?.abort(); };
    window.addEventListener("fashion:session-changed", cancel);
    return () => { active.current = false; cancel(); window.removeEventListener("fashion:session-changed", cancel); };
  }, []);
  useEffect(() => { if (selected) previewHeading.current?.focus({ preventScroll: true }); }, [selected]);
  const files = [...new Map((query.data?.pages.flatMap(page => page.items) ?? []).map(file => [file.id, file])).values()];
  const nextExpiry = Math.min(...[...files, ...(selected ? [selected] : [])].flatMap(file => file.expiresAt && Date.parse(file.expiresAt) > now ? [Date.parse(file.expiresAt)] : []));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, Math.max(0, nextExpiry - Date.now()) + 20));
    return () => clearTimeout(timer);
  }, [nextExpiry]);
  const expired = (file: ProjectGeneratedFile) => file.status === "expired" || Boolean(file.expiresAt && Date.parse(file.expiresAt) <= now);
  const place = async (file?: ProjectGeneratedFile) => {
    if (placementLock.current || !canPlace || !placement.ready) return;
    placementLock.current = true; setPlacementPreparing(true); setPlacementError(null);
    try {
      const position = await onPreparePlacement?.();
      if (!active.current) return;
      const mediaPosition = file?.domain === "runway" && position && window.innerWidth < 768
        ? { x: position.x - 155, y: position.y + 110 }
        : position;
      const pending = placement.pending?.command;
      const resourceKey = file?.id ?? (pending?.type === "place_generated_media" ? `runway:${pending.mediaId}` : pending ? `asset:${pending.assetId}` : undefined);
      const nodeId = await placement.execute(file ? { assetId: file.resourceId, title: file.title, archived: file.archived, domain: file.domain === "runway" ? "runway" : "asset", ...(mediaPosition ? { position: mediaPosition } : {}) } : undefined);
      if (active.current && resourceKey && nodeId) setPlacedFiles(previous => new Map(previous).set(resourceKey, nodeId));
    } catch (cause) { if (active.current) setPlacementError(cause instanceof Error ? cause.message : "放入白板尚未完成，请重试。"); }
    finally { placementLock.current = false; if (active.current) setPlacementPreparing(false); }
  };
  const download = async (file: ProjectGeneratedFile) => {
    if (flight.current) return;
    const controller = new AbortController(); flight.current = controller; setBusy(file.id); setDownloadError(null); setNotice("");
    try {
      await downloadGeneratedFile(projectId, file, controller);
      if (active.current && !controller.signal.aborted) setNotice("已交给浏览器下载，可在浏览器中查看进度。");
    } catch (cause) {
      if (active.current && !controller.signal.aborted) setDownloadError({ id: file.id, message: cause instanceof Error ? cause.message : "下载暂未开始，请重试。" });
    } finally { if (flight.current === controller) { flight.current = null; if (active.current) setBusy(null); } }
  };
  const close = () => { flight.current?.abort(); onClose(); };
  const back = () => {
    const id = selected?.id; setSelected(null); setPathOpen(false);
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-file-preview="${CSS.escape(id ?? "")}"]`)?.focus({ preventScroll: true }));
  };
  const actions = (file: ProjectGeneratedFile) => <div className={styles.actions}>
    <button type="button" disabled={Boolean(busy) || expired(file) || file.status === "unavailable"} onClick={() => void download(file)} aria-label={`下载 ${file.title}`}>
      <WorkspaceIcon name="download" />{busy === file.id ? "准备下载…" : expired(file) ? "文件已过期" : file.status === "unavailable" ? "暂不可下载" : "下载"}
    </button>
    {file.nodeId ? <button type="button" onClick={() => {
      if (onLocate(file.nodeId ?? "")) close();
      else setNotice("当前画布中已没有这个结果，仍可在这里预览和下载。");
    }}>定位到画布</button> : null}
    {placedFiles.has(file.id) ? <button type="button" onClick={() => {
      if (file.domain === "runway") { close(); return; }
      const id = placedFiles.get(file.id); if (id && onLocate(id)) close();
    }}>查看已放入的{file.domain === "runway" ? "媒体" : "版本"}</button> : canPlace && ((file.domain === "asset" && file.kind === "image") || (file.domain === "runway" && ["video", "audio"].includes(file.kind))) && !isPlaced?.(file.resourceId, file.domain as "asset" | "runway") ? <button type="button" disabled={!placement.ready || placementPreparing || placement.busy || Boolean(placement.pending) || file.status !== "ready"} onClick={() => void place(file)}>{file.domain === "asset" && file.archived ? "以新版本放入画布" : "放入画布"}</button> : null}
    {file.sourceHref ? <a href={file.sourceHref} onClick={close}>{expired(file) ? "回到来源重新导出" : "查看来源"}</a> : null}
  </div>;
  return <Dialog label="生成文件" onClose={() => selected ? back() : close()} returnFocusSelector='[data-guide="workspace-functions"]' className={styles.dialog}>
    <div className={styles.shell} data-generated-files>
      <header className={styles.header}><div><h2>生成文件</h2><p>项目中的图片、媒体和导出记录</p></div><button type="button" aria-label="关闭生成文件" onClick={close}><WorkspaceIcon name="close" /></button></header>
      {placement.pending || placement.error || placementError || placementPreparing || placedNode ? <section className={styles.placement} aria-label="文件放置状态">
        {placement.pending ? <><span>{placement.pending.title} 的放置尚待确认</span>{canPlace ? <button type="button" disabled={placement.busy || placementPreparing} onClick={() => void place()}>{placement.busy || placementPreparing ? "正在放入画布…" : "继续确认放置"}</button> : <span>当前只能查看，请恢复编辑权限后继续。</span>}</> : placementPreparing ? <span role="status">正在准备白板…</span> : null}
        {placement.error || placementError ? <p role="alert">{placement.error ?? placementError}</p> : null}
        {!placement.ready && placement.error ? <button type="button" onClick={() => void placement.reload()}>重新读取放置记录</button> : null}
        {placedNode && !placement.pending ? <><span role="status">已放入白板</span><button type="button" onClick={() => { if (placedMedia) close(); else if (onLocate(placedNode)) close(); }}>{placedMedia ? "返回白板" : "查看已放入的图片"}</button></> : null}
      </section> : null}
      <div hidden={Boolean(selected)} className={styles.listView} inert={Boolean(selected)}>
        <div className={styles.controls}><label className={styles.search}>查找<input type="search" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} placeholder="名称、操作或文件编号" aria-label="查找生成文件" /></label>
          <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新文件</button>
        </div>
        <div className={styles.filters} role="group" aria-label="生成文件类型">{filters.map(([value, label]) => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}</div>
        <div ref={list} className={styles.list} aria-label="生成文件列表" aria-busy={query.isFetching}>
          {query.isPending ? <p role="status" className={styles.empty}>正在读取生成文件…</p> : null}
          {query.isError ? <div role="alert" className={styles.error}><span>{query.error.message}</span><button type="button" disabled={query.isFetching} onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>重试读取文件</button></div> : null}
          {!query.isPending && !query.isError && !files.length ? <p className={styles.empty}>{q ? "没有找到匹配的生成文件" : kind === "all" ? "项目还没有生成文件" : `暂无${kindLabels[kind as keyof typeof kindLabels]}文件`}</p> : null}
          {files.map(file => <article key={file.id} className={styles.row} data-generated-file-id={file.id}>
            <button type="button" className={styles.previewButton} data-file-preview={file.id} aria-label={`预览 ${file.title}`} onClick={() => { setSelected(file); setPathOpen(false); }}>
              {file.previewUrl ? <ImagePreview src={file.previewUrl} alt="" retryable={false} revealOnLoad={false} /> : <span className={styles.fileKind}>{kindLabels[file.kind]}</span>}
            </button>
            <div className={styles.fileInfo}><button type="button" className={styles.title} onClick={() => { setSelected(file); setPathOpen(false); }}>{file.title}</button>
              <div className={styles.metadata}><span>{file.operation}</span><time dateTime={file.createdAt}>{dateFormatter.format(new Date(file.createdAt))}</time>{file.archived ? <span>已归档</span> : null}</div>
              <div className={styles.metadata}>{file.width && file.height ? <span>{file.width} × {file.height}</span> : null}{generatedFileSize(file.sizeBytes) ? <span>{generatedFileSize(file.sizeBytes)}</span> : null}{file.durationMs ? <span>{Math.round(file.durationMs / 1000)} 秒</span> : null}</div>
              {actions(file)}
              {file.domain === "export" && !file.sourceHref ? <p className={styles.rowError}>原来源已不可用，导出记录仍保留。</p> : null}
              {downloadError?.id === file.id ? <p role="alert" className={styles.rowError}>{downloadError.message}</p> : null}
            </div>
          </article>)}
          {query.hasNextPage && !query.isFetchNextPageError ? <button type="button" className={styles.more} disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "正在读取…" : "加载更多文件"}</button> : null}
        </div>
        <footer className={styles.footer}><span>已读取 {files.length} 项{query.hasNextPage ? "，还有更多" : ""}</span><span role="status">{notice}</span></footer>
      </div>
      {selected ? <div className={styles.detail}>
        <button type="button" className={styles.back} onClick={back}>返回文件列表</button>
        <h3 ref={previewHeading} tabIndex={-1}>{selected.title}</h3>
        <div className={styles.metadata}><span>{selected.operation}</span><time dateTime={selected.createdAt}>{dateFormatter.format(new Date(selected.createdAt))}</time>{selected.archived ? <span>已归档</span> : null}</div>
        {selected.status !== "ready" || expired(selected) ? <p>{expired(selected) ? selected.sourceHref ? "文件已过期，生成记录仍保留。请回到来源重新导出。" : "文件已过期，原来源已不可用，导出记录仍保留。" : "文件暂不可用，生成记录仍保留。"}</p> : selected.kind === "image" ? <div className={styles.largePreview}><ImagePreview src={selected.contentUrl ?? undefined} alt={selected.title} revealOnLoad={false} /></div> : selected.kind === "video" || selected.kind === "audio" ? <GeneratedMedia key={selected.id} file={selected} /> : <p>文档可下载后查看。</p>}
        {actions(selected)}
        {downloadError?.id === selected.id ? <p role="alert" className={styles.rowError}>{downloadError.message}</p> : null}
        <p role="status">{notice}</p>
        {selected.domain === "asset" ? <><button type="button" aria-expanded={pathOpen} onClick={() => setPathOpen(value => !value)}>{pathOpen ? "收起设计路径" : "查看设计路径"}</button>{pathOpen ? <DesignPathPanel assetId={selected.resourceId} readOnly embedded /> : null}</> : null}
      </div> : null}
    </div>
  </Dialog>;
}

function GeneratedMedia({ file }: { file: ProjectGeneratedFile }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed) return <div role="alert" className={styles.error}>媒体预览暂不可用。<button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重试媒体预览</button></div>;
  const props = { controls: true, preload: "metadata", src: file.contentUrl ?? undefined, "aria-label": file.title, onError: () => setFailed(true) };
  return file.kind === "video" ? <video key={attempt} className={styles.media} {...props} /> : <audio key={attempt} {...props} />;
}
