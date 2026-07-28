"use client";

import { type ReactNode, useState } from "react";

import type { CollectionDna, PaletteColor } from "./collection-types";
import styles from "./generation.module.css";

type LockKey = keyof CollectionDna["locks"];

export function DNACard({
  dna,
  onChange,
}: {
  readonly dna: CollectionDna;
  readonly onChange: (dna: CollectionDna) => void;
}) {
  const [silhouettesText, setSilhouettesText] = useState(
    dna.silhouettes.join("，"),
  );
  const [fabricsText, setFabricsText] = useState(dna.fabrics.join("，"));
  const [moodWordsText, setMoodWordsText] = useState(dna.moodWords.join("，"));

  const setLock = (key: LockKey, locked: boolean): void => {
    onChange({ ...dna, locks: { ...dna.locks, [key]: locked } });
  };
  const setPalette = (palette: readonly PaletteColor[]): void => {
    onChange({ ...dna, palette });
  };

  return (
    <div className={styles.dnaCard}>
      <DnaSection
        label="01 / COLOR SYSTEM"
        locked={dna.locks.palette}
        onLock={(locked) => setLock("palette", locked)}
        title="色板"
      >
        {dna.palette.length === 0 ? (
          <p className={styles.dnaEmpty}>暂无色彩。添加第一枚系列色。</p>
        ) : (
          <div className={styles.paletteEditor}>
            {dna.palette.map((color, index) => (
              <div className={styles.paletteRow} key={`${index}-${color.hex}`}>
                <input
                  aria-label={`色板颜色 ${index + 1}`}
                  disabled={dna.locks.palette}
                  onChange={(event) => {
                    const next = [...dna.palette];
                    next[index] = { ...color, hex: event.target.value };
                    setPalette(next);
                  }}
                  type="color"
                  value={color.hex}
                />
                <input
                  aria-label={`颜色 ${index + 1} 名称`}
                  disabled={dna.locks.palette}
                  maxLength={40}
                  onChange={(event) => {
                    const next = [...dna.palette];
                    next[index] = { ...color, name: event.target.value };
                    setPalette(next);
                  }}
                  value={color.name}
                />
                <code>{color.hex.toUpperCase()}</code>
                <button
                  aria-label={`移除颜色 ${color.name}`}
                  disabled={dna.locks.palette}
                  onClick={() =>
                    setPalette(dna.palette.filter((_, item) => item !== index))
                  }
                  type="button"
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          className={styles.dnaAdd}
          disabled={dna.locks.palette || dna.palette.length >= 12}
          onClick={() =>
            setPalette([...dna.palette, { hex: "#D8C8B6", name: "新系列色" }])
          }
          type="button"
        >
          添加颜色
        </button>
      </DnaSection>

      <DnaSection
        label="02 / SILHOUETTE"
        locked={dna.locks.silhouettes}
        onLock={(locked) => setLock("silhouettes", locked)}
        title="廓形"
      >
        <TokenTextarea
          disabled={dna.locks.silhouettes}
          label="廓形关键词，以逗号或换行分隔"
          onChange={(text, values) => {
            setSilhouettesText(text);
            onChange({ ...dna, silhouettes: values });
          }}
          value={silhouettesText}
        />
      </DnaSection>

      <DnaSection
        label="03 / MATERIAL"
        locked={dna.locks.fabrics}
        onLock={(locked) => setLock("fabrics", locked)}
        title="面料"
      >
        <TokenTextarea
          disabled={dna.locks.fabrics}
          label="面料关键词，以逗号或换行分隔"
          onChange={(text, values) => {
            setFabricsText(text);
            onChange({ ...dna, fabrics: values });
          }}
          value={fabricsText}
        />
      </DnaSection>

      <DnaSection
        label="04 / MOOD"
        locked={dna.locks.moodWords}
        onLock={(locked) => setLock("moodWords", locked)}
        title="情绪词"
      >
        <TokenTextarea
          disabled={dna.locks.moodWords}
          label="情绪关键词，以逗号或换行分隔"
          onChange={(text, values) => {
            setMoodWordsText(text);
            onChange({ ...dna, moodWords: values });
          }}
          value={moodWordsText}
        />
      </DnaSection>
    </div>
  );
}

function DnaSection({
  children,
  label,
  locked,
  onLock,
  title,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly locked: boolean;
  readonly onLock: (locked: boolean) => void;
  readonly title: string;
}) {
  return (
    <section className={styles.dnaSection} data-locked={locked}>
      <header>
        <div>
          <span>{label}</span>
          <h3>{title}</h3>
        </div>
        <button
          aria-pressed={locked}
          onClick={() => onLock(!locked)}
          type="button"
        >
          {locked ? "解锁" : "锁定"}
        </button>
      </header>
      <div>{children}</div>
    </section>
  );
}

function TokenTextarea({
  disabled,
  label,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (text: string, values: readonly string[]) => void;
  readonly value: string;
}) {
  return (
    <label className={styles.dnaTextarea}>
      <span>{label}</span>
      <textarea
        disabled={disabled}
        maxLength={780}
        onChange={(event) => {
          const text = event.target.value;
          const values = text
            .split(/[，,\n]/)
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 12);
          onChange(text, values);
        }}
        rows={3}
        value={value}
      />
    </label>
  );
}
