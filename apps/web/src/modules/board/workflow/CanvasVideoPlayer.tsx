"use client";
import { useEffect, useRef, useState } from "react";
import { useCanvasMediaActivity } from "./canvas-media-context";
import styles from "./node-entry.module.css";

export function CanvasVideoPlayer({ id, url, title, visible = true, inOverlay = false, zoom = 1 }: { id: string; url: string; title: string; visible?: boolean; inOverlay?: boolean; zoom?: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvasActive = useCanvasMediaActivity();
  const active = inOverlay || canvasActive;
  const [info, setInfo] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = video.current;
    const pause = () => video.current?.pause();
    const hidden = () => { if (document.hidden) pause(); };
    const other = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) pause(); };
    if (!active || !visible) pause();
    document.addEventListener("visibilitychange", hidden); window.addEventListener("fashion:canvas-media-play", other);
    return () => { element?.pause(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("fashion:canvas-media-play", other); };
  }, [id, active, visible, attempt]);
  const safe = /^\/api\/(files\/[^/?#]+\/content|projects\/[^/?#]+\/runway\/media\/[^/?#]+\/content)$/u.test(url);
  return <div className={styles.video} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {safe && !failed ? <video key={`${url}:${attempt}`} ref={video} src={url} aria-label={title} controls playsInline preload={active && visible ? "metadata" : "none"}
      onLoadedMetadata={event => { const item = event.currentTarget; if (!item.videoWidth || !item.videoHeight) { setFailed(true); return; } setInfo(`${item.videoWidth} × ${item.videoHeight}${Number.isFinite(item.duration) ? `　${Math.floor(item.duration / 60)}:${String(Math.floor(item.duration % 60)).padStart(2,"0")}` : ""}`); }}
      onPlay={() => { if (!active || !visible) video.current?.pause(); else window.dispatchEvent(new CustomEvent("fashion:canvas-media-play", { detail: id })); }} onError={() => setFailed(true)} />
      : <div className={styles.upload}><p>视频暂时无法播放，请检查文件格式或重试。</p><button onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重试播放</button></div>}
    {info && !failed ? <span className={styles.mediaInfo} style={{ transform: `scale(${1 / Math.max(.05, zoom)})`, transformOrigin: "top left" }}>{info}</span> : null}
  </div>;
}
