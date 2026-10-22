"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { PAINTING_MEDIA, type PaintingId } from "./painting-media";
import styles from "./task-feedback.module.css";
import { Tooltip } from "./ui";

// Only the most recently opened, visible task may play. Others keep their poster.
const candidates = new Set<string>();
const listeners = new Set<() => void>();
const owner = () => [...candidates].at(-1) ?? null;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const publish = () => listeners.forEach((listener) => listener());

export default function PaintingLoader({
  painting,
  compact = false,
}: {
  readonly painting: PaintingId;
  readonly compact?: boolean;
}) {
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const activeOwner = useSyncExternalStore(subscribe, owner, () => null);
  const media = PAINTING_MEDIA[painting];

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReduced(preference.matches);
      setForeground(document.visibilityState === "visible");
    };
    update();
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.1 },
    );
    if (host.current) observer.observe(host.current);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  const eligible = visible && foreground && !reduced && !failed;
  useEffect(() => {
    if (!eligible) return;
    candidates.add(id);
    publish();
    return () => {
      candidates.delete(id);
      publish();
    };
  }, [eligible, id]);
  const loadVideo = eligible && activeOwner === id;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let disposed = false;
    if (paused || !loadVideo) element.pause();
    else
      void element.play().catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      element.pause();
    };
  }, [loadVideo, paused]);

  useEffect(() => {
    const element = video.current;
    return () => {
      if (!element) return;
      element.pause();
      element.removeAttribute("src");
      element
        .querySelectorAll("source")
        .forEach((source) => source.removeAttribute("src"));
      element.load();
    };
  }, [loadVideo]);

  return (
    <div className={styles.painting} data-compact={compact} ref={host}>
      <div className={styles.swatch} aria-hidden="true">
        {loadVideo ? (
          <video
            ref={video}
            muted
            loop
            playsInline
            preload="none"
            poster={media.poster}
            width={media.width}
            height={media.height}
            onError={() => setFailed(true)}
          >
            <source src={media.webm} type="video/webm" />
            <source src={media.mp4} type="video/mp4" />
          </video>
        ) : !posterFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.poster}
            width={media.width}
            height={media.height}
            alt=""
            loading="lazy"
            onError={() => setPosterFailed(true)}
          />
        ) : (
          <span className={styles.paper} />
        )}
      </div>
      <div className={styles.paintingControls}>
        <Tooltip content="等待时播放的绘画，与任务结果和完成进度无关。">
          <button type="button" aria-label="关于等待动画">
            等待动画
          </button>
        </Tooltip>
        {loadVideo ? (
          <button
            type="button"
            aria-pressed={paused}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? "播放动画" : "暂停动画"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
