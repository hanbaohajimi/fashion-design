"use client";

import { useEffect, useRef, useState } from "react";
import { BaseBoxShapeUtil, Box, HTMLContainer, T, useEditor, useValue, type RecordProps } from "tldraw";
import { MEDIA_SHAPE_TYPE, type MediaShape } from "./shape-types";
import { useCanvasMediaActivity } from "../workflow/canvas-media-context";
import { mediaDuration } from "../workflow/canvas-media";
import { downloadGeneratedFile } from "../workflow/generated-files-api";
import { WorkspaceIcon } from "../workflow/WorkspaceIcon";
import styles from "./media-shape.module.css";

export class MediaShapeUtil extends BaseBoxShapeUtil<MediaShape> {
  static override type = MEDIA_SHAPE_TYPE;
  static override props: RecordProps<MediaShape> = {
    w: T.number, h: T.number, title: T.string, mediaId: T.string,
    mediaKind: T.literalEnum("video", "audio"), mediaUrl: T.string, sourceHref: T.string, durationMs: T.number,
  };
  override getDefaultProps(): MediaShape["props"] {
    return { w: 360, h: 306, title: "媒体素材", mediaId: "", mediaKind: "video", mediaUrl: "", sourceHref: "", durationMs: 0 };
  }
  override isAspectRatioLocked() { return true; }
  override canResize() { return true; }
  override component(shape: MediaShape) { return <MediaContent key={shape.props.mediaUrl} shape={shape} />; }
  override getText(shape: MediaShape) { return shape.props.title; }
  override getIndicatorPath(shape: MediaShape): Path2D { const path = new Path2D(); path.rect(0, 0, shape.props.w, shape.props.h); return path; }
}

function safeMediaSource(value: string, mediaId: string): boolean {
  if (value.includes("\\") || /[\u0000-\u001f]/u.test(value)) return false;
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin && !url.search && !url.hash
      && /^\/api\/projects\/[^/]+\/runway\/media\/[^/]+\/content$/u.test(url.pathname)
      && url.pathname.endsWith(`/media/${encodeURIComponent(mediaId)}/content`);
  } catch { return false; }
}

function safeSourceHref(value: string): boolean {
  if (!value.startsWith("/") || /[\\\u0000-\u001f\u007f]/u.test(value)) return false;
  try { const url = new URL(value, location.origin); return url.origin === location.origin && /^\/[^/]+\/studio$/u.test(url.pathname); }
  catch { return false; }
}

function MediaContent({ shape }: { shape: MediaShape }) {
  const editor = useEditor();
  const active = useCanvasMediaActivity();
  const visible = useValue(`media-visible-${shape.id}`, () => {
    const bounds = editor.getShapePageBounds(shape.id);
    return !editor.isShapeHidden(shape.id) && Boolean(bounds && Box.Collides(editor.getViewportPageBounds(), bounds));
  }, [editor, shape.id]);
  const enabled = active && visible;
  const element = useRef<HTMLMediaElement | null>(null);
  const [engaged, setEngaged] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [playing, setPlaying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const downloadRequest = useRef<AbortController | null>(null);
  const sourceValid = safeMediaSource(shape.props.mediaUrl, shape.props.mediaId);
  useEffect(() => () => downloadRequest.current?.abort(), []);
  useEffect(() => {
    const current = element.current;
    const pause = () => element.current?.pause();
    const visibility = () => { if (document.visibilityState !== "visible") pause(); };
    const other = (event: Event) => { if ((event as CustomEvent<string>).detail !== shape.id) pause(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("fashion:canvas-media-play", other);
    if (!enabled) pause();
    return () => { current?.pause(); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("fashion:canvas-media-play", other); };
  }, [enabled, shape.id, attempt, failed]);
  const start = async () => {
    const media = element.current;
    if (!media || !enabled) return;
    setEngaged(true); setNotice(""); setLoading(true);
    try { await media.play(); }
    catch { setNotice("播放暂未开始，请使用播放器的播放按钮重试。"); }
    finally { setLoading(false); }
  };
  const download = async () => {
    if (downloadRequest.current) return;
    const controller = new AbortController(); downloadRequest.current = controller; setDownloading(true); setNotice("");
    try {
      const projectId = decodeURIComponent(new URL(shape.props.mediaUrl, location.origin).pathname.split("/")[3] ?? "");
      await downloadGeneratedFile(projectId, { domain: "runway", resourceId: shape.props.mediaId }, controller);
      if (!controller.signal.aborted) setNotice("已交给浏览器下载原文件。");
    } catch (error) {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "原文件暂时无法下载，请重试。");
    } finally {
      if (downloadRequest.current === controller) { downloadRequest.current = null; if (!controller.signal.aborted) setDownloading(false); }
    }
  };
  const player = {
    src: shape.props.mediaUrl, controls: engaged, preload: "metadata" as const,
    "aria-label": shape.props.title, onError: () => { setFailed(true); setLoading(false); },
    onPlay: () => { setPlaying(true); window.dispatchEvent(new CustomEvent("fashion:canvas-media-play", { detail: shape.id })); },
    onPause: () => setPlaying(false), onEnded: () => setPlaying(false),
  };
  return <HTMLContainer className={styles.card} data-canvas-node-id={typeof shape.meta.canvasNodeId === "string" ? shape.meta.canvasNodeId : undefined} data-canvas-media={shape.props.mediaId} data-playing={playing}>
    <header className={styles.header}><span>{shape.props.mediaKind === "video" ? "视频" : "音频"}</span><strong title={shape.props.title}>{shape.props.title}</strong>{mediaDuration(shape.props.durationMs) ? <time>{mediaDuration(shape.props.durationMs)}</time> : null}</header>
    <div className={styles.player} data-kind={shape.props.mediaKind} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      {!sourceValid || failed ? <div className={styles.error} role="alert"><span>{sourceValid ? "媒体暂时无法播放" : "媒体来源尚未核实"}</span>{sourceValid ? <button type="button" onClick={() => { setFailed(false); setEngaged(false); setAttempt(value => value + 1); }}>重新加载媒体</button> : null}</div>
        : enabled ? <>
          {shape.props.mediaKind === "video" ? <video key={attempt} className={styles.video} ref={value => { element.current = value; }} playsInline {...player} />
            : <audio key={attempt} className={styles.audio} ref={value => { element.current = value; }} {...player} />}
          {!engaged ? <button className={styles.play} type="button" aria-label={`播放 ${shape.props.title}`} disabled={loading} onClick={() => void start()}><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 4 12 8-12 8Z" /></svg><span>{loading ? "正在准备…" : "点击播放"}</span></button> : null}
        </> : <span className={styles.paused}>媒体已暂停</span>}
    </div>
    <footer className={styles.footer} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      {sourceValid ? <button type="button" disabled={downloading} onClick={() => void download()}><WorkspaceIcon name="download" />{downloading ? "准备下载…" : "原文件"}</button> : null}
      {safeSourceHref(shape.props.sourceHref) ? <a href={shape.props.sourceHref}>查看来源</a> : null}
      {notice ? <span role="status" className={styles.notice}>{notice}</span> : null}
    </footer>
  </HTMLContainer>;
}
