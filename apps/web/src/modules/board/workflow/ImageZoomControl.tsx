"use client";

import { Button, Input } from "../../../components/ui";
import { useId, useImperativeHandle, useState, type Ref } from "react";

export interface ImageZoomControlHandle {
  previewZoom: (percent: number | null) => void;
}
/** 手势预览只更新这一个控件；完整图片工作区仅在手势结束提交缩放。 */
export function ImageZoomControl({
  zoom,
  onChange,
  ref,
}: {
  zoom: number | null;
  onChange: (zoom: number | null) => void;
  ref: Ref<ImageZoomControlHandle>;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const [committed, setCommitted] = useState(zoom);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const hint = useId();
  if (committed !== zoom) {
    setCommitted(zoom);
    setPreview(null);
    setDraft(null);
    setInvalid(false);
  }
  useImperativeHandle(ref, () => ({ previewZoom: setPreview }), []);
  const value = preview === null ? zoom : Math.round(preview * 100) / 100;
  const apply = () => {
    if (draft === null) return;
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < 10 || next > 400) {
      setInvalid(true);
      return;
    }
    setPreview(null);
    setDraft(null);
    setInvalid(false);
    if (next !== value) onChange(next);
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        maxWidth: "100%",
        gap: 8,
      }}
    >
      <Input
        aria-label="缩放比例"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? hint : undefined}
        type="number"
        min={10}
        max={400}
        step="any"
        placeholder="自动"
        value={draft ?? value ?? ""}
        style={{ width: 88 }}
        title="输入 10–400，按 Enter 或离开输入框应用"
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setInvalid(false);
        }}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            apply();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(null);
            setInvalid(false);
          }
        }}
      />
      <span aria-hidden="true">%</span>
      <Button
        aria-pressed={value === null}
        onClick={() => {
          setPreview(null);
          setDraft(null);
          setInvalid(false);
          onChange(null);
        }}
      >
        适合窗口
      </Button>
      {invalid ? (
        <small
          id={hint}
          role="alert"
          style={{ color: "var(--color-status-error)", flexBasis: "100%" }}
        >
          请输入 10–400 的缩放比例。
        </small>
      ) : null}
    </span>
  );
}
