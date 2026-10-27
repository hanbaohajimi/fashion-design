"use client";

import { useLayoutEffect, useRef, type ComponentProps, type Ref } from "react";
import { createImeGuard } from "./assistant-ime";
import styles from "./assistant-composer.module.css";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

export function AssistantComposer({ onSend, ref: forwardedRef, ...props }: ComponentProps<"textarea"> & { onSend: () => void }) {
  const element = useRef<HTMLTextAreaElement | null>(null);
  const guard = useRef(createImeGuard());
  useLayoutEffect(() => {
    const input = element.current;
    if (!input || CSS.supports?.("field-sizing", "content")) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, parseFloat(getComputedStyle(input).maxHeight) || 240)}px`;
  }, [props.value]);
  return <textarea {...props} className={`${styles.input} ${props.className ?? ""}`} ref={node => {
    element.current = node;
    assignRef(forwardedRef, node);
  }} onCompositionStart={event => { guard.current.start(); props.onCompositionStart?.(event); }} onCompositionEnd={event => { guard.current.end(); props.onCompositionEnd?.(event); }} onKeyDown={event => {
    if (guard.current.blocks({ key: event.key, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); return; }
    props.onKeyDown?.(event);
    if (!event.defaultPrevented && event.key === "Enter" && !event.shiftKey && !event.repeat) { event.preventDefault(); onSend(); }
  }} />;
}
