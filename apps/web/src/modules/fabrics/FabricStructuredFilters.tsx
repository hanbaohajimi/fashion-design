"use client";

import { useState } from "react";
import type { FabricListQuery } from "./fabric-types";
import styles from "./fabrics.module.css";

type StructuredQuery = Pick<FabricListQuery, "category" | "fiber" | "supplier" | "minWeightGsm" | "maxWeightGsm">;
const EMPTY = { category: "", fiber: "", supplier: "", minWeightGsm: "", maxWeightGsm: "" };
const FIELDS = [
  { key: "category", label: "面料分类", placeholder: "完整分类名称" },
  { key: "fiber", label: "成分", placeholder: "例如：棉" },
  { key: "supplier", label: "供应商", placeholder: "供应商名称" },
  { key: "minWeightGsm", label: "最低克重（g/m²）", placeholder: "不限" },
  { key: "maxWeightGsm", label: "最高克重（g/m²）", placeholder: "不限" },
] as const;

export function FabricStructuredFilters({ onApply }: { readonly onApply: (query: StructuredQuery) => void }) {
  const [values, setValues] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  return <details className={styles.specDisclosure}><summary>规格筛选{applied.length ? ` · ${applied.join("、")}` : ""}</summary><form className={styles.structuredFilters} aria-label="按面料规格筛选" onSubmit={(event) => {
    event.preventDefault();
    const min = values.minWeightGsm.trim() ? Number(values.minWeightGsm) : undefined;
    const max = values.maxWeightGsm.trim() ? Number(values.maxWeightGsm) : undefined;
    if ((min !== undefined && (!Number.isFinite(min) || min < 0 || min > 10_000)) || (max !== undefined && (!Number.isFinite(max) || max <= 0 || max > 10_000))) {
      setError("请填写 0 至 10000 范围内的有效克重，最高克重需大于 0"); return;
    }
    if (min !== undefined && max !== undefined && min > max) { setError("最低克重不能大于最高克重"); return; }
    setError(null);
    const query: Record<string, string | number> = {};
    for (const key of ["category", "fiber", "supplier"] as const) if (values[key].trim()) query[key] = values[key].trim();
    if (min !== undefined) query.minWeightGsm = min;
    if (max !== undefined) query.maxWeightGsm = max;
    onApply(query);
    setApplied(FIELDS.filter(({ key }) => query[key] !== undefined).map(({ key, label }) => `${label}：${query[key]}`));
    event.currentTarget.closest("details")?.removeAttribute("open");
  }}>
    {FIELDS.map(({ key, label, placeholder }) => <label key={key}>
      <span>{label}</span>
      <input type={key.includes("Weight") ? "number" : "text"} min={0} max={key.includes("Weight") ? 10_000 : undefined} step="any"
        maxLength={key === "supplier" ? 160 : key === "category" ? 80 : 60}
        placeholder={placeholder} value={values[key]} onChange={(event) => setValues({ ...values, [key]: event.currentTarget.value })} />
    </label>)}
    <div className={styles.filterActions}>
      <button type="submit">应用筛选</button>
      <button type="button" onClick={() => { setValues(EMPTY); setApplied([]); setError(null); onApply({}); }}>重置</button>
      <span>仅筛选已填写的规格，图片标签不会作为成分或克重依据。</span>
    </div>
    {error ? <p role="alert" className={styles.filterError}>{error}</p> : null}
  </form></details>;
}
