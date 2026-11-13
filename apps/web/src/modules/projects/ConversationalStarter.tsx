"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import styles from "./ConversationalStarter.module.css";

const TEMPLATE_CHIPS = [
  { label: "做一个系列", value: "我想做一组服装系列，" },
  { label: "从面料出发", value: "我有一块面料，想从它出发设计，" },
  { label: "视觉提案", value: "我需要为品牌做一组视觉提案，" },
  { label: "从趋势开始", value: "我看到一个趋势想要探索，" },
] as const;

interface ConversationalStarterProps {
  readonly disabled?: boolean;
  readonly onSubmit: (brief: string) => void;
}

export function ConversationalStarter({ disabled, onSubmit }: ConversationalStarterProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChip = (prefix: string) => {
    const next = value ? value : prefix;
    setValue(next.startsWith(prefix) ? next : prefix + value);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !disabled) {
        onSubmit(trimmed);
        setValue("");
      }
    }
  };

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && !disabled) {
      onSubmit(trimmed);
      setValue("");
    }
  };

  return (
    <div className={styles.starter}>
      <div className={styles.inputWrap}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          disabled={disabled}
          maxLength={1200}
          placeholder="「想做一组秋冬系列，主材羊毛，参考 Loewe 的松弛感…」"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="描述你的创作想法"
        />
        <button
          className={styles.sendButton}
          disabled={disabled || !value.trim()}
          type="button"
          aria-label="开始创作"
          onClick={handleSubmit}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className={styles.chips} role="group" aria-label="快速模板">
        {TEMPLATE_CHIPS.map((chip) => (
          <button
            key={chip.label}
            className={styles.chip}
            disabled={disabled}
            type="button"
            onClick={() => handleChip(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>
    </div>
  );
}
