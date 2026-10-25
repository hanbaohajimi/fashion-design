"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, ImagePreview } from "../../components/ui";
import { MatrixVariant } from "./MatrixVariant";
import { CompareVariant } from "./CompareVariant";
import { QueueVariant } from "./QueueVariant";
import { VariantPicker } from "./VariantPicker";
import { FIXTURE_LABELS, resultFixtures, type FixtureMode } from "./fixtures";
import styles from "./prototype.module.css";

export function ResultSelectionPrototype({
  initialVariant = 0,
  initialMode = "demo",
}: {
  readonly initialVariant?: number;
  readonly initialMode?: FixtureMode;
}) {
  const [variant, setVariant] = useState(initialVariant);
  const [mode, setMode] = useState(initialMode);
  const [items, setItems] = useState(() => resultFixtures(initialMode));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [readOnly, setReadOnly] = useState(false);
  const [inspected, setInspected] = useState<string | null>(null);
  const [savePreview, setSavePreview] = useState(false);
  const [revision, setRevision] = useState(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const owned = timers.current;
    return () => owned.forEach(clearTimeout);
  }, []);
  const updateUrl = (key: string, value: string) => {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    history.replaceState(null, "", url);
  };
  const chooseVariant = useCallback((value: number) => {
    setVariant(value);
    updateUrl("v", String(value + 1));
  }, []);
  const replay = useCallback(() => setRevision((value) => value + 1), []);
  const item = items.find((entry) => entry.id === inspected);
  const props = {
    items,
    selected,
    readOnly,
    onToggle: (id: string) => {
      if (!readOnly)
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
    },
    onInspect: setInspected,
    onRetry: (id: string) => {
      if (
        readOnly ||
        items.find((entry) => entry.id === id)?.state !== "failed"
      )
        return;
      setItems((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, state: "running" } : entry,
        ),
      );
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setItems((current) =>
          current.map((entry) =>
            entry.id === id ? { ...entry, state: "ready" } : entry,
          ),
        );
      }, 600);
      timers.current.add(timer);
    },
  };
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>ATELIER / DESIGN STUDY</span>
          <h1>挑选下一版风衣</h1>
          <p>同一批次，同一组候选。比较廓形与色料，留下值得继续的方向。</p>
        </div>
        <Link href="/prototypes/ui-boundaries">查看数据边界演示 →</Link>
      </header>
      <section className={styles.harness} aria-label="演示设置">
        <label>
          数据{" "}
          <select
            aria-label="演示数据"
            value={mode}
            onChange={(event) => {
              const next = event.target.value as FixtureMode;
              timers.current.forEach(clearTimeout);
              timers.current.clear();
              setMode(next);
              setItems(resultFixtures(next));
              setSelected(new Set());
              setRevision((value) => value + 1);
              updateUrl("data", next);
            }}
          >
            {Object.entries(FIXTURE_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
          />
          只读权限
        </label>
        <p>演示数据与示意图 · 不生成、不计费、不写入项目</p>
      </section>
      <div className={styles.summary}>
        <div>
          <strong>秋冬通勤 / 面料与领口实验</strong>
          <p role="status">
            {items.length} 个候选 · 已选择 {selected.size} 张 · 尚未保存
          </p>
        </div>
        <Button
          variant="primary"
          disabled={readOnly || !selected.size}
          onClick={() => setSavePreview(true)}
        >
          查看款式保存预览
        </Button>
      </div>
      <div key={`${variant}:${mode}:${revision}`} className={styles.stage}>
        {!items.length ? (
          <div className={styles.empty}>
            当前批次没有候选。切换演示数据查看完整流程。
          </div>
        ) : variant === 0 ? (
          <MatrixVariant {...props} />
        ) : variant === 1 ? (
          <CompareVariant {...props} />
        ) : (
          <QueueVariant {...props} />
        )}
      </div>
      <VariantPicker
        value={variant}
        onChange={chooseVariant}
        onReplay={replay}
      />
      {item ? (
        <Dialog label="候选原图与来源" onClose={() => setInspected(null)}>
          <div className={styles.detail}>
            <div className={styles.image}>
              <ImagePreview src={item.image} alt={item.name} />
            </div>
            <h2>{item.name}</h2>
            <p>来源：{item.source}</p>
            <p>参数：保留肩线 / 中等纹理强度 / 同一批次</p>
            <details open>
              <summary>完整提示词</summary>
              <p>{item.prompt}</p>
            </details>
            <Button onClick={() => setInspected(null)}>关闭详情</Button>
          </div>
        </Dialog>
      ) : null}
      {savePreview ? (
        <Dialog label="款式保存预览" onClose={() => setSavePreview(false)}>
          <div className={styles.detail}>
            <h2>已选 {selected.size} 张候选</h2>
            <ul>
              {items
                .filter((entry) => selected.has(entry.id))
                .map((entry) => (
                  <li key={entry.id}>{entry.name}</li>
                ))}
            </ul>
            <p>这是本地保存预览，尚未创建任何正式款式。</p>
            <Button onClick={() => setSavePreview(false)}>返回继续挑选</Button>
          </div>
        </Dialog>
      ) : null}
    </main>
  );
}
