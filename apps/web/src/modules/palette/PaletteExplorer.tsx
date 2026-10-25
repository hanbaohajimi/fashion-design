"use client";

// Hierarchy: proposed swatches, then controls, then ΔE guidance. Apply is
// secondary to the host's save action. Reuse paper/ink, space-2/3/4/6 and
// radius-md tokens from the existing light theme; no new design system.
import { useId, useRef, useState } from "react";
import { Button, Input, Select } from "../../components/ui";
import type { PaletteColor } from "../board/generation/collection-types";
import {
  colorForeground,
  explorePalette,
  PALETTE_LIMIT,
  type PaletteStrategy,
} from "./color-exploration";
import styles from "./palette-explorer.module.css";

export function PaletteExplorer({
  colors,
  disabled = false,
  onApply,
}: {
  readonly colors: readonly PaletteColor[];
  readonly disabled?: boolean;
  readonly onApply: (colors: PaletteColor[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const trigger = useRef<HTMLDivElement>(null);
  const id = useId();
  const blocked =
    disabled || colors.length === 0 || colors.length >= PALETTE_LIMIT;
  const expanded = open && !blocked;
  const close = () => {
    setOpen(false);
    trigger.current?.querySelector("button")?.focus();
  };
  return (
    <div className={styles.panel}>
      <div ref={trigger}>
        <Button
          aria-expanded={expanded}
          aria-controls={expanded ? id : undefined}
          disabled={blocked}
          onClick={() => {
            setOpen(!open);
            setNotice("");
          }}
        >
          探索配色
        </Button>
      </div>
      <p className={styles.hint} role="status">
        {disabled
          ? "色板当前不可修改。"
          : colors.length === 0
            ? "先添加一个基准色，再探索配色。"
            : colors.length >= PALETTE_LIMIT
              ? "已达 12 色上限，请删除颜色后再探索。"
              : notice || "保留原色，探索可以追加的新配色。"}
      </p>
      {expanded ? (
        <section id={id} aria-label="配色探索" className={styles.body}>
          <PaletteOptions
            key={JSON.stringify(colors)}
            colors={colors}
            onCancel={close}
            onApply={(next) => {
              onApply(next);
              setNotice(`已追加 ${next.length - colors.length} 色。`);
              close();
            }}
          />
        </section>
      ) : null}
    </div>
  );
}

function PaletteOptions({
  colors,
  onApply,
  onCancel,
}: {
  readonly colors: readonly PaletteColor[];
  readonly onApply: (colors: PaletteColor[]) => void;
  readonly onCancel: () => void;
}) {
  const [baseIndex, setBaseIndex] = useState(0);
  const [strategy, setStrategy] = useState<PaletteStrategy>("tonal");
  const [count, setCount] = useState(
    Math.min(3, PALETTE_LIMIT - colors.length),
  );
  const baseHex = colors[baseIndex]?.hex ?? colors[0]?.hex ?? "";
  const result = explorePalette({ baseHex, existing: colors, strategy, count });
  return (
    <>
      <div className={styles.controls}>
        <label className={styles.field}>
          基准色
          <Select
            value={baseIndex}
            onChange={(event) => setBaseIndex(Number(event.target.value))}
          >
            {colors.map((color, i) => (
              <option key={i} value={i}>
                {i + 1}. {color.name} · {color.hex.toUpperCase()}
              </option>
            ))}
          </Select>
        </label>
        <label className={styles.field}>
          配色策略
          <Select
            value={strategy}
            onChange={(event) =>
              setStrategy(event.target.value as PaletteStrategy)
            }
          >
            <option value="tonal">同色系</option>
            <option value="analogous">邻近色</option>
            <option value="complementary">互补色</option>
          </Select>
        </label>
        <label className={styles.field}>
          追加数量
          <Select
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {Array.from(
              { length: Math.min(5, PALETTE_LIMIT - colors.length) },
              (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1} 色
                </option>
              ),
            )}
          </Select>
        </label>
      </div>
      <div>
        <h4 className={styles.heading}>原有颜色 · 保留 {colors.length} 色</h4>
        <ul className={styles.originals} aria-label="原有颜色">
          {colors.map((color, i) => (
            <li key={i}>
              <ColorChip color={color} />
              <span>{color.name}</span>
            </li>
          ))}
        </ul>
      </div>
      <PalettePreview
        key={`${baseIndex}:${strategy}:${count}`}
        colors={colors}
        result={result}
        onApply={onApply}
        onCancel={onCancel}
      />
    </>
  );
}

function PalettePreview({
  colors,
  result,
  onApply,
  onCancel,
}: {
  readonly colors: readonly PaletteColor[];
  readonly result: ReturnType<typeof explorePalette>;
  readonly onApply: (colors: PaletteColor[]) => void;
  readonly onCancel: () => void;
}) {
  const [names, setNames] = useState(() =>
    result.suggestions.map((color) => color.name),
  );
  const suggestions = result.suggestions.map((color, i) => ({
    ...color,
    name: names[i] ?? color.name,
  }));
  const combined = [...colors, ...suggestions];
  const valid =
    suggestions.length > 0 &&
    suggestions.every((color) => color.name.trim().length > 0);
  return (
    <>
      <div>
        <h4 className={styles.heading}>建议追加 · {suggestions.length} 色</h4>
        <ul className={styles.suggestions} aria-label="建议颜色">
          {suggestions.map((color, i) => (
            <li key={color.hex}>
              <ColorChip color={color} />
              <label className={styles.field}>
                建议色 {i + 1} 名称
                <Input
                  aria-invalid={!color.name.trim() || undefined}
                  maxLength={40}
                  value={color.name}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                  onChange={(event) =>
                    setNames(
                      names.map((name, index) =>
                        index === i ? event.target.value : name,
                      ),
                    )
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.hint} role="status">
        {result.message ? <p>{result.message}</p> : null}
        {result.warnings.length ? (
          <>
            <p>
              颜色接近：以下色对的 ΔE 小于 5，仅作为设计辅助提示，不会自动删色。
            </p>
            <ul className={styles.warnings}>
              {result.warnings.map(({ left, right, deltaE }) => (
                <li key={`${left}:${right}`}>
                  {left + 1}. {combined[left]?.name} 与 {right + 1}.{" "}
                  {combined[right]?.name} · ΔE {deltaE.toFixed(1)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>近似色提示采用 ΔE &lt; 5，仅作设计辅助参考。</p>
        )}
        {!valid && suggestions.length > 0 ? (
          <p>请为每个建议色填写名称。</p>
        ) : null}
      </div>
      <div className={styles.actions}>
        <Button
          disabled={!valid}
          onClick={() =>
            onApply([
              ...colors,
              ...suggestions.map((color) => ({
                ...color,
                name: color.name.trim(),
              })),
            ])
          }
        >
          应用配色
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          取消预览
        </Button>
      </div>
    </>
  );
}

function ColorChip({ color }: { readonly color: PaletteColor }) {
  return (
    <span
      className={styles.chip}
      style={{ backgroundColor: color.hex, color: colorForeground(color.hex) }}
    >
      <code>{color.hex.toUpperCase()}</code>
    </span>
  );
}
