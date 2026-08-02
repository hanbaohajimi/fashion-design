"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { useFabrics } from "../../modules/fabrics/fabric-api";
import {
  filterFabrics,
  type FabricWeightFilter,
} from "../../modules/fabrics/fabric-filters";
import { FabricVirtualGrid } from "../../modules/fabrics/FabricVirtualGrid";
import styles from "../../modules/fabrics/fabrics.module.css";

const CATEGORIES = ["all", "cotton", "silk", "wool", "synthetic", "blend"] as const;
const COMPOSITIONS = ["all", "cotton", "silk", "wool", "polyester", "spandex"] as const;
const SEASONS = ["all", "spring", "summer", "autumn", "winter"] as const;
const WEIGHTS: readonly FabricWeightFilter[] = ["all", "light", "medium", "heavy"];

const LABELS: Readonly<Record<string, string>> = {
  all: "全部",
  autumn: "秋季",
  blend: "混纺",
  cotton: "棉",
  heavy: "重磅 · 200+",
  light: "轻薄 · <100",
  medium: "中等 · 100–200",
  polyester: "聚酯纤维",
  silk: "真丝",
  spandex: "氨纶",
  spring: "春季",
  summer: "夏季",
  synthetic: "化纤",
  winter: "冬季",
  wool: "羊毛",
};

function FilterGroup({
  label,
  onChange,
  options,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly string[];
  readonly value: string;
}) {
  return (
    <fieldset className={styles.filterGroup}>
      <legend>{label}</legend>
      <div>
        {options.map((option) => (
          <button
            aria-pressed={value === option}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            {LABELS[option] ?? option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function FabricsPage() {
  const [category, setCategory] = useState("all");
  const [composition, setComposition] = useState("all");
  const [season, setSeason] = useState("all");
  const [weight, setWeight] = useState<FabricWeightFilter>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const fabrics = useFabrics({
    category,
    scope: "all",
    search: deferredSearch,
  });
  const filtered = useMemo(
    () => filterFabrics(fabrics.items, { composition, season, weight }),
    [composition, fabrics.items, season, weight],
  );

  return (
    <main className={styles.libraryPage}>
      <header className={styles.libraryHeader}>
        <div>
          <Link href="/">← 项目库</Link>
          <span>FABRIC ARCHIVE / 8.2</span>
        </div>
        <div className={styles.searchWrap}>
          <label htmlFor="fabric-search">搜索面料</label>
          <input
            id="fabric-search"
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="搜索名称、品类或织法…"
            type="search"
            value={search}
          />
          <kbd>⌘ K</kbd>
        </div>
      </header>

      <section className={styles.libraryIntro}>
        <div>
          <span>DIGITAL TEXTILE INDEX</span>
          <h1>面料不是素材，<br />是设计的第一层结构。</h1>
        </div>
        <p>
          浏览预置档案与个人上传，将真实的克重、成分和织法直接带入设计白板。
        </p>
      </section>

      <div className={styles.libraryBody}>
        <aside className={styles.filterRail} aria-label="面料筛选">
          <div className={styles.filterRailTitle}>
            <span>FILTER / 04</span>
            <button
              onClick={() => {
                setCategory("all");
                setComposition("all");
                setSeason("all");
                setWeight("all");
              }}
              type="button"
            >
              重置
            </button>
          </div>
          <FilterGroup label="品类" onChange={setCategory} options={CATEGORIES} value={category} />
          <FilterGroup label="成分" onChange={setComposition} options={COMPOSITIONS} value={composition} />
          <FilterGroup label="克重 / GSM" onChange={(value) => setWeight(value as FabricWeightFilter)} options={WEIGHTS} value={weight} />
          <FilterGroup label="适用季节" onChange={setSeason} options={SEASONS} value={season} />
        </aside>

        <section className={styles.archivePanel} aria-label="面料列表">
          <div className={styles.resultMeta}>
            <p><strong>{filtered.length.toString().padStart(2, "0")}</strong> 项可用档案</p>
            <span>{fabrics.total} 条记录 · 拖拽卡片至白板</span>
          </div>
          {fabrics.isLoading ? (
            <div className={styles.libraryState}><span>LOADING TEXTURES</span><p>正在读取面料档案…</p></div>
          ) : fabrics.error ? (
            <div className={styles.libraryState} data-error>
              <span>ARCHIVE OFFLINE</span><p>{fabrics.error.message}</p>
              <button onClick={fabrics.refresh} type="button">重新加载</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className={styles.libraryState}><span>NO MATCH</span><p>没有符合当前条件的面料，试试放宽筛选。</p></div>
          ) : (
            <FabricVirtualGrid fabrics={filtered} height={680} onNearEnd={fabrics.loadMore} />
          )}
          {fabrics.isLoadingMore ? <p className={styles.loadingMore}>正在展开下一柜档案…</p> : null}
        </section>
      </div>
    </main>
  );
}
