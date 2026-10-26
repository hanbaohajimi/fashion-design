"use client";

import { useEffect, useRef, useState } from "react";
import { useAnimatedPresence } from "./use-animated-presence";
import styles from "./shared-motion.module.css";

export function ConnectionNotice() {
  const [state, setState] = useState<"offline" | "restored" | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const presence = useAnimatedPresence<HTMLSpanElement>(state !== null, ref, {
    enter: { opacity: 0, transform: "translateY(-4px)" },
    enterToken: "--motion-menu-enter", exitToken: "--motion-menu-enter", enterMs: 300, exitMs: 300,
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let offline = !navigator.onLine;
    const disconnected = () => { offline = true; clearTimeout(timer); setState("offline"); };
    const connected = () => {
      if (!offline) return;
      offline = false;
      clearTimeout(timer);
      setState("restored");
      timer = setTimeout(() => setState(null), 1000);
    };
    if (offline) disconnected();
    window.addEventListener("offline", disconnected);
    window.addEventListener("online", connected);
    return () => { clearTimeout(timer); window.removeEventListener("offline", disconnected); window.removeEventListener("online", connected); };
  }, []);
  if (!presence.present) return null;
  const connected = state !== "offline";
  return <span ref={ref} className={styles.connection} data-connected={connected} role="status" aria-atomic="true" aria-hidden={!state || undefined} aria-label={connected ? "连接已恢复" : "网络已断开，已加载的内容仍可查看"}>
    <span aria-hidden="true" className={styles.connectionFull}>{connected ? "连接已恢复" : "网络已断开"}</span>
    <span aria-hidden="true" className={styles.connectionShort}>{connected ? "已连接" : "离线"}</span>
  </span>;
}
