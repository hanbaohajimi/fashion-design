"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui";
import { UI_TIMING } from "../../../components/ui-config";
import styles from "./image-workspace.module.css";

export function CopyImageLinkButton({ value, onError }: { value: string; onError: (error: string | null) => void }) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) { setLastValue(value); setCopiedValue(null); }
  const copied = copiedValue === value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);
  useEffect(() => { ++revision.current; if (timer.current) clearTimeout(timer.current); }, [value]);
  return <Button aria-label={copied ? "已复制" : "复制链接"} className={styles.copyFeedback} data-copied={copied} onClick={async () => {
    if (busy.current) return;
    busy.current = true;
    const attempt = revision.current;
    try {
      await navigator.clipboard.writeText(value);
      if (!mounted.current || attempt !== revision.current) return;
      onError(null); setCopiedValue(value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedValue(null), UI_TIMING.copyFeedback);
    } catch { if (mounted.current && attempt === revision.current) { setCopiedValue(null); onError("未能复制链接，请选中链接手动复制。"); } }
    finally { busy.current = false; }
  }}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path className={styles.copyIcon} d="M5 5h8v9H5z M2 10V2h8" fill="none" stroke="currentColor" /><path className={styles.copyCheck} pathLength="1" d="m3 8 3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    <span className={styles.copyLabel}><span aria-hidden="true">复制链接</span><span>{copied ? "已复制" : "复制链接"}</span></span>
    <span className={styles.srOnly} role="status">{copied ? "链接已复制" : ""}</span>
  </Button>;
}
