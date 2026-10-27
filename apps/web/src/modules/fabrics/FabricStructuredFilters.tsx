"use client";

import { useEffect, useRef, useState } from "react";
import type { FabricListQuery } from "./fabric-types";
import styles from "./fabrics.module.css";
import { Button, Dialog } from "../../components/ui";

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
  const [activeQuery, setActiveQuery] = useState<StructuredQuery>({});
  const [mobile, setMobile] = useState(false);
  const [open, setOpen] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const applied = FIELDS.filter(({ key }) => activeQuery[key] !== undefined);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 767px)");
    if (!media) return;
    const update = () => { setMobile(media.matches); setOpen(false); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const clear = () => {
    setActiveQuery({}); setValues(EMPTY); setError(null); onApply({});
  };
  const form = <form className={styles.structuredFilters} aria-label="按面料规格筛选" onSubmit={(event) => {
    event.preventDefault();
    const min = values.minWeightGsm.trim() ? Number(values.minWeightGsm) : undefined;
    const max = values.maxWeightGsm.trim() ? Number(values.maxWeightGsm) : undefined;
    if ((min !== undefined && (!Number.isFinite(min) || min < 0 || min > 10_000)) ||
      (max !== undefined && (!Number.isFinite(max) || max <= 0 || max > 10_000))) {
      setError("请填写 0 至 10000 范围内的有效克重，最高克重需大于 0"); return;
    }
    if (min !== undefined && max !== undefined && min > max) { setError("最低克重不能大于最高克重"); return; }
    const query: Record<string, string | number> = {};
    for (const key of ["category", "fiber", "supplier"] as const) if (values[key].trim()) query[key] = values[key].trim();
    if (min !== undefined) query.minWeightGsm = min;
    if (max !== undefined) query.maxWeightGsm = max;
    setError(null); setActiveQuery(query); onApply(query); setOpen(false);
    if (disclosure.current) disclosure.current.open = false;
  }}>
    {FIELDS.map(({ key, label, placeholder }) => <label key={key}>
      <span>{label}</span>
      <input type={key.includes("Weight") ? "number" : "text"} min={0} max={key.includes("Weight") ? 10_000 : undefined}
        step="any" maxLength={key === "supplier" ? 160 : key === "category" ? 80 : 60}
        placeholder={placeholder} value={values[key]}
        onChange={(event) => setValues({ ...values, [key]: event.currentTarget.value })} />
    </label>)}
    <div className={styles.filterActions}>
      <Button variant="primary" type="submit">应用筛选</Button>
      <Button onClick={clear}>重置</Button>
      {mobile ? <Button onClick={() => setOpen(false)}>取消</Button> : null}
      <span>仅筛选已填写的规格，图片标签不会作为成分或克重依据。</span>
    </div>
    <p role={error ? "alert" : undefined} className={styles.filterError}>{error}</p>
  </form>;
  return <>
    <div className={styles.filterChips} aria-label="已启用的规格筛选">
      {applied.map(({ key, label }) => <Button key={key} size="small" aria-label={`移除${label}筛选`} onClick={() => {
        const query = Object.fromEntries(Object.entries(activeQuery).filter(([name]) => name !== key));
        setActiveQuery(query); setValues((current) => ({ ...current, [key]: "" })); onApply(query);
      }}>{label}：{activeQuery[key]} ×</Button>)}
      {applied.length ? <Button variant="ghost" onClick={clear}>清空筛选</Button> : null}
    </div>
    {mobile ? <>
      <Button data-fabric-filter-trigger aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        规格筛选{applied.length ? ` ${applied.length} 项已启用` : ""}
      </Button>
      <Dialog open={open} variant="sheet" label="面料规格筛选" onClose={() => setOpen(false)}
        onAfterClose={() => setError(null)} returnFocusSelector="[data-fabric-filter-trigger]"
        className={styles.filterSheet}>
        <div data-sheet-handle className={styles.filterHandle} aria-hidden="true"><span /></div>
        <header className={styles.filterSheetHeader}><h2>规格筛选</h2><Button onClick={() => setOpen(false)} aria-label="关闭规格筛选">×</Button></header>
        {form}
      </Dialog>
    </> : <details ref={disclosure} className={styles.specDisclosure}>
      <summary data-fabric-filter-trigger>规格筛选{applied.length ? ` ${applied.length} 项已启用` : ""}</summary>
      {form}
    </details>}
  </>;
}
