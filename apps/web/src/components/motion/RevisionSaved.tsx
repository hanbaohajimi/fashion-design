"use client";

import { useEffect, useRef, useState } from "react";
import { useCoutureMotion } from "./use-couture-motion";
import styles from "./motion.module.css";

/** Owned by the workspace, so refreshing the saved editor cannot erase feedback. */
export function RevisionSaved() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [receipt, setReceipt] = useState("");
  const play = useCoutureMotion();
  useEffect(() => {
    const scope = anchor.current?.closest("[data-studio-motion]");
    const saved = (event: Event) =>
      setReceipt((event as CustomEvent<string>).detail);
    scope?.addEventListener("atelier:revision-saved", saved);
    return () => scope?.removeEventListener("atelier:revision-saved", saved);
  }, []);
  useEffect(() => {
    if (!receipt) return;
    const frame = requestAnimationFrame(() =>
      play("seal", {
        anchor: anchor.current,
        eventKey: `studio-save:${receipt}`,
      }),
    );
    const timer = setTimeout(() => setReceipt(""), 1600);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [receipt, play]);
  return (
    <span
      ref={anchor}
      role="status"
      className={styles.revisionSaved}
      data-visible={Boolean(receipt)}
    >
      {receipt ? "已保存" : ""}
    </span>
  );
}
