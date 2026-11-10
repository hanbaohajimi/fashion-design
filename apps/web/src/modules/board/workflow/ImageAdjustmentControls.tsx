import { useId, useState } from "react";
import { hasImageAdjustments, imageTransformSchema, originalImageAdjustments, type ImageAdjustments, type ImageTransform } from "@fashion/shared";
import type { ImageSize } from "./ImageViewer";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./image-orientation.module.css";
import workspaceStyles from "./image-workspace.module.css";

const controls = [
  { key: "brightness", label: "亮度" },
  { key: "contrast", label: "对比度" },
  { key: "saturation", label: "饱和度" },
  { key: "warmth", label: "冷暖" },
] as const;

export function ImageAdjustmentControls({ value, onChange, size, locked, comparing, onCompare, onSave }: {
  value: ImageAdjustments;
  onChange: (value: ImageAdjustments) => void;
  size: ImageSize | null;
  locked: boolean;
  comparing: boolean;
  onCompare: (value: boolean) => void;
  onSave: (params: ImageTransform) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<{ key: keyof ImageAdjustments; text: string } | null>(null);
  const invalid = draft !== null && (!draft.text.trim() || !Number.isFinite(Number(draft.text)) || Math.abs(Number(draft.text)) > 100);
  const changed = hasImageAdjustments(value);
  const parsed = size ? imageTransformSchema.safeParse({ ...size, adjustments: value, prompt: "调整图片色彩与明暗" }) : null;
  const update = (next: ImageAdjustments) => { onCompare(false); onChange(next); };
  return <>
    <div className={styles.content} role="group" aria-label="色彩调整参数">
      <p className={styles.intro}>调整整张图片的色彩与明暗，随时查看原图。</p>
      <fieldset className={styles.controls} disabled={locked || !size}>
        <legend className={workspaceStyles.srOnly}>图片色彩设置</legend>
        {controls.map(({ key, label }) => <div className={styles.group} key={key}>
          <div className={styles.angleRow}>
            <label htmlFor={`${id}-${key}`}>{label}</label>
            <div className={styles.angleInput}>
              <input id={`${id}-${key}`} type="number" min={-100} max={100} step={1} inputMode="decimal"
                value={draft?.key === key ? draft.text : value[key]}
                aria-invalid={draft?.key === key && invalid || undefined}
                aria-describedby={draft?.key === key && invalid ? `${id}-error` : undefined}
                onChange={event => {
                  const text = event.currentTarget.value, amount = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(amount) && Math.abs(amount) <= 100) update({ ...value, [key]: amount });
                  setDraft({ key, text });
                }}
                onBlur={() => setDraft(null)}
                onKeyDown={event => { if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); setDraft(null); } }} />
            </div>
          </div>
          <input type="range" aria-label={`拖动调整${label}`} min={-100} max={100} step={1} value={value[key]}
            onChange={event => { setDraft(null); update({ ...value, [key]: Number(event.currentTarget.value) }); }} />
        </div>)}
        {invalid ? <small id={`${id}-error`} role="alert">请输入 −100 至 100 的数值。</small> : null}
        <div className={styles.pair}>
          <button type="button" disabled={!changed} aria-pressed={comparing} onClick={() => onCompare(!comparing)}>
            <WorkspaceIcon name="image" />{comparing ? "返回预览" : "查看原图"}
          </button>
          <button type="button" disabled={!changed} onClick={() => { setDraft(null); update({ ...originalImageAdjustments }); }}>
            <WorkspaceIcon name="reset" />复位
          </button>
        </div>
      </fieldset>
      {parsed && !parsed.success ? <p role="alert">图片尺寸超出保存范围，请先使用“调整大小”。</p> : null}
    </div>
    <div className={styles.save}>
      <button type="button" className={workspaceStyles.primary} disabled={locked || invalid || !changed || !parsed?.success}
        onClick={() => { if (parsed?.success) onSave(parsed.data); }}>保存为新版本</button>
      <small>原图保留，不消耗生图额度。</small>
    </div>
  </>;
}
