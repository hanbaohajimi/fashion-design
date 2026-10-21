"use client";

import { fabricDetailsSchema, type FabricDetails, type FabricProvenance, type FabricSpecField } from "@fashion/shared";
import styles from "./fabrics.module.css";

const FIELDS = [
  { key: "name", label: "面料名称", max: 120 },
  { key: "code", label: "内部编号", max: 80 },
  { key: "category", label: "面料分类", max: 80 },
  { key: "composition", label: "成分与比例", placeholder: "棉:60, 亚麻:40", spec: true },
  { key: "weightGsm", label: "克重（g/m²）", type: "number", spec: true },
  { key: "widthCm", label: "门幅（cm）", type: "number", spec: true },
  { key: "stretch", label: "弹性说明", max: 120, spec: true },
  { key: "weave", label: "组织结构", max: 120, spec: true },
  { key: "supplier", label: "供应商", max: 160, spec: true },
  { key: "supplierCode", label: "供应商货号", max: 100, spec: true },
  { key: "price", label: "报价", type: "number", spec: true },
  { key: "unit", label: "计价 / 起订单位", placeholder: "例如：米、公斤", max: 40, spec: true },
  { key: "currency", label: "币种", placeholder: "CNY / USD", max: 3, spec: true },
  { key: "quotedAt", label: "报价日期", type: "date", spec: true },
  { key: "moq", label: "起订量", type: "number", spec: true },
  { key: "appearanceNotes", label: "外观说明", max: 1000, spec: true },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
export interface FabricDetailsDraft {
  readonly values: Record<FieldKey, string>;
  readonly sources: NonNullable<FabricDetails["provenance"]>;
}

export function createFabricDetailsDraft(details?: FabricDetails | null): FabricDetailsDraft {
  return {
    values: Object.fromEntries(FIELDS.map(({ key }) => [key, key === "composition"
      ? (details?.composition ?? []).map((item) => item.fiber + ":" + item.percent).join(", ")
      : String(details?.[key] ?? "")])) as Record<FieldKey, string>,
    sources: { ...details?.provenance },
  };
}

export function parseFabricDetailsDraft(draft: FabricDetailsDraft):
  { readonly success: true; readonly details: FabricDetails | null } |
  { readonly success: false; readonly error: string } {
  const values: Record<string, unknown> = {};
  const provenance: Record<string, FabricProvenance> = {};
  for (const field of FIELDS) {
    const value = draft.values[field.key].trim();
    if (!value) continue;
    if (field.key === "composition") {
      const components = value.split(/[,，、\n]+/u).filter(Boolean).map((part) => {
        const match = /^(.+?)\s*[:：]\s*(\d+(?:\.\d+)?)\s*%?$/u.exec(part.trim());
        return match ? { fiber: match[1]?.trim(), percent: Number(match[2]) } : null;
      });
      if (components.some((item) => item === null)) return { success: false, error: "成分请按“棉:60, 亚麻:40”填写，比例合计须为 100%" };
      values[field.key] = components;
    } else if ("type" in field && field.type === "number") values[field.key] = Number(value);
    else values[field.key] = field.key === "currency" ? value.toUpperCase() : value;
    if ("spec" in field && field.spec) {
      const source = draft.sources[field.key as FabricSpecField];
      if (source) provenance[field.key] = source;
    }
  }
  if (Object.keys(values).length === 0) return { success: true, details: null };
  const result = fabricDetailsSchema.safeParse({ ...values, provenance });
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path;
    const key = (path?.[0] === "provenance" ? path[1] : path?.[0]) as FieldKey | undefined;
    const label = FIELDS.find((field) => field.key === key)?.label;
    return { success: false, error: (label ? label + "：" : "") + (issue?.message ?? "档案内容无效") };
  }
  return { success: true, details: result.data };
}

export function FabricDetailsEditor({ value, onChange, disabled = false }: {
  readonly value: FabricDetailsDraft;
  readonly onChange: (value: FabricDetailsDraft) => void;
  readonly disabled?: boolean;
}) {
  return <fieldset className={styles.detailsEditor} disabled={disabled}>
    <legend>面料档案（选填）</legend>
    <p className={styles.provenanceHelp}>未知规格请留空。成分、物性和报价需注明资料来源；AI 建议仅用于外观说明。</p>
    <div className={styles.specFields}>
      {FIELDS.map((field) => {
        const source = value.sources[field.key as FabricSpecField];
        const hasValue = Boolean(value.values[field.key].trim());
        return <div className={styles.specField} key={field.key}>
          <label>
            <span>{field.label}</span>
            <input
              type={"type" in field ? field.type : "text"}
              step={"type" in field && field.type === "number" ? "any" : undefined}
              min={"type" in field && field.type === "number" ? 0 : undefined}
              maxLength={"max" in field ? field.max : 200}
              placeholder={"placeholder" in field ? field.placeholder : "未知请留空"}
              value={value.values[field.key]}
              onChange={(event) => onChange({ ...value, values: { ...value.values, [field.key]: event.currentTarget.value } })}
            />
          </label>
          {"spec" in field && field.spec && hasValue ? <div className={styles.sourceFields}>
            <label>
              <span>{field.label}资料来源</span>
              <select value={source?.source ?? ""} onChange={(event) => {
                const nextSources = { ...value.sources };
                const next = event.currentTarget.value as FabricProvenance["source"] | "";
                if (!next) nextSources[field.key as FabricSpecField] = undefined;
                else nextSources[field.key as FabricSpecField] = { source: next, ...(source?.note ? { note: source.note } : {}) };
                onChange({ ...value, sources: nextSources });
              }}>
                <option value="">请选择来源</option>
                <option value="manual">人工填写</option>
                <option value="supplier">供应商资料</option>
                <option value="measured">实测</option>
                {field.key === "appearanceNotes" ? <option value="ai_visual">AI 外观建议</option> : null}
              </select>
            </label>
            {source ? <label>
              <span>{field.label}来源备注</span>
              <input maxLength={500} placeholder="例如：资料页编号、测量日期" value={source.note ?? ""}
                onChange={(event) => onChange({ ...value, sources: { ...value.sources, [field.key]: { ...source, note: event.currentTarget.value } } })} />
            </label> : null}
          </div> : null}
        </div>;
      })}
    </div>
  </fieldset>;
}

const SOURCE_LABELS: Record<FabricProvenance["source"], string> = {
  manual: "人工填写", supplier: "供应商资料", measured: "实测", ai_visual: "AI 外观建议",
};

export function FabricDetailsSummary({ details }: { readonly details?: FabricDetails | null | undefined }) {
  if (!details) return <p className={styles.provenanceHelp}>尚未填写面料规格，原有图片和标签仍可使用。</p>;
  return <dl className={styles.fabricDetailList}>
    {FIELDS.map((field) => {
      const value = details[field.key];
      if (value === undefined || value === null || (Array.isArray(value) && !value.length)) return null;
      const source = details.provenance?.[field.key as FabricSpecField];
      return <div key={field.key}><dt>{field.label}</dt><dd>
        {Array.isArray(value) ? value.map((item) => item.fiber + " " + item.percent + "%").join(" / ") : String(value)}
        {source ? <small className={styles.sourceNote}>{SOURCE_LABELS[source.source]}{source.note ? " · " + source.note : ""}</small> : null}
      </dd></div>;
    })}
  </dl>;
}
