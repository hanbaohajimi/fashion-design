"use client";
import { useEffect, useRef, type CSSProperties } from "react";
import { createImeGuard } from "../../../components/assistant-ime";
import styles from "./node-entry.module.css";

export function ManualTextEditor({ value, onChange, onSave, readonly, style }: { value: string; onChange: (text: string) => void; onSave: () => void; readonly: boolean; style: CSSProperties }) {
  const ime = useRef(createImeGuard());
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  return <div className={styles.manualEditor} style={style} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <textarea ref={input} aria-label="节点文本内容" value={value} readOnly={readonly} maxLength={12000} placeholder="输入文本内容，Ctrl+Enter 保存" onChange={event => onChange(event.target.value)} onCompositionStart={() => ime.current.start()} onCompositionEnd={() => ime.current.end()}
      onKeyDown={event => { if (["Control", "Meta", "Alt", "Shift"].includes(event.key) || ime.current.blocks(event.nativeEvent)) return; if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); if (!readonly) onSave(); } }} />
  </div>;
}
