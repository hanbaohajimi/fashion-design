"use client";

import { createTechPackRowId, type BomDraft, type PomDraft } from "./tech-pack-draft";
import { Button, Input, Select } from "../../components/ui";
import styles from "./studio.module.css";

type FieldError = { label: string; id: string };
function errorProps(label: string, error?: FieldError) {
  return {
    "aria-invalid": error?.label === label || undefined,
    "aria-describedby": error?.label === label ? error.id : undefined,
  };
}

const SOURCE_LABELS = {
  manual: "人工填写",
  supplier: "供应商资料",
  measured: "实测",
  ai: "AI 建议",
};

export function BomTable({
  rows,
  onChange,
  disabled,
  error,
}: {
  readonly rows: BomDraft[];
  readonly onChange: (rows: BomDraft[]) => void;
  readonly disabled: boolean;
  readonly error?: FieldError | undefined;
}) {
  const update = (index: number, patch: Partial<BomDraft>) =>
    onChange(
      rows.map((row, at) =>
        at === index
          ? {
              ...row,
              ...patch,
              ...(patch.reviewed === undefined ? { reviewed: false } : {}),
            }
          : row,
      ),
    );
  return (
    <div className={styles.stack}>
      <div className={styles.recordHeader}>
        <h3>材料与辅料 · BOM</h3>
        <Button
          disabled={disabled || rows.length >= 100}
          onClick={() =>
            onChange([
              ...rows,
              {
                uiId: createTechPackRowId(),
                name: "",
                material: "",
                quantity: "",
                unit: "米",
                supplier: "",
                reviewed: false,
                source: "manual",
              },
            ])
          }
        >
          添加材料
        </Button>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>名称</th>
              <th>材料说明</th>
              <th>用量</th>
              <th>单位</th>
              <th>供应商</th>
              <th>依据</th>
              <th>人工复核</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.uiId}>
                <td>
                  <Input
                    aria-label={"BOM " + (index + 1) + " 名称"}
                    {...errorProps("BOM " + (index + 1) + " 名称", error)}
                    maxLength={120}
                    value={row.name}
                    required
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, { name: event.target.value })
                    }
                  />
                </td>
                <td>
                  <Input
                    aria-label={"BOM " + (index + 1) + " 材料"}
                    {...errorProps("BOM " + (index + 1) + " 材料", error)}
                    maxLength={2000}
                    value={row.material}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, { material: event.target.value })
                    }
                  />
                </td>
                <td>
                  <Input
                    aria-label={"BOM " + (index + 1) + " 用量"}
                    {...errorProps("BOM " + (index + 1) + " 用量", error)}
                    value={row.quantity ?? ""}
                    inputMode="decimal"
                    disabled={disabled}
                    placeholder="未知"
                    onChange={(event) =>
                      update(index, { quantity: event.target.value })
                    }
                  />
                </td>
                <td>
                  <Input
                    aria-label={"BOM " + (index + 1) + " 单位"}
                    {...errorProps("BOM " + (index + 1) + " 单位", error)}
                    maxLength={120}
                    value={row.unit}
                    required
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, { unit: event.target.value })
                    }
                  />
                </td>
                <td>
                  <Input
                    aria-label={"BOM " + (index + 1) + " 供应商"}
                    {...errorProps("BOM " + (index + 1) + " 供应商", error)}
                    maxLength={2000}
                    value={row.supplier}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, { supplier: event.target.value })
                    }
                  />
                </td>
                <td>
                  <Select
                    aria-label={"BOM " + (index + 1) + " 依据"}
                    {...errorProps("BOM " + (index + 1) + " 依据", error)}
                    value={row.source}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, {
                        source: event.target.value as typeof row.source,
                      })
                    }
                  >
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>
                  <input
                    aria-label={"BOM " + (index + 1) + " 已复核"}
                    {...errorProps("BOM " + (index + 1) + " 已复核", error)}
                    type="checkbox"
                    checked={row.reviewed}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, { reviewed: event.target.checked })
                    }
                  />
                </td>
                <td>
                  <Button
                    size="small"
                    disabled={disabled}
                    onClick={() =>
                      onChange(rows.filter((_, at) => at !== index))
                    }
                  >
                    移除
                  </Button>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={8} className={styles.muted}>
                  尚未记录材料。未知用量留空，发布前补充并人工复核。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PomTable({
  rows,
  onChange,
  disabled,
  error,
}: {
  readonly rows: PomDraft[];
  readonly onChange: (rows: PomDraft[]) => void;
  readonly disabled: boolean;
  readonly error?: FieldError | undefined;
}) {
  const update = (index: number, patch: Partial<PomDraft>) =>
    onChange(
      rows.map((row, at) =>
        at === index
          ? {
              ...row,
              ...patch,
              ...(patch.reviewed === undefined ? { reviewed: false } : {}),
            }
          : row,
      ),
    );
  return (
    <div className={styles.stack}>
      <div className={styles.recordHeader}>
        <h3>测量规格 · POM</h3>
        <Button
          disabled={disabled || rows.length >= 100}
          onClick={() =>
            onChange([
              ...rows,
              {
                uiId: createTechPackRowId(),
                name: "",
                value: "",
                unit: "cm",
                tolerance: "",
                reviewed: false,
                source: "manual",
              },
            ])
          }
        >
          添加测量部位
        </Button>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>部位</th>
              <th>尺寸</th>
              <th>单位</th>
              <th>允许公差 ±</th>
              <th>依据</th>
              <th>人工复核</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.uiId}>
                <td>
                  <Input
                    aria-label={"POM " + (index + 1) + " 部位"}
                    {...errorProps("POM " + (index + 1) + " 部位", error)}
                    maxLength={120}
                    value={row.name}
                    disabled={disabled}
                    required
                    onChange={(event) =>
                      update(index, { name: event.target.value })
                    }
                  />
                </td>
                <td>
                  <Input
                    aria-label={"POM " + (index + 1) + " 尺寸"}
                    {...errorProps("POM " + (index + 1) + " 尺寸", error)}
                    value={row.value ?? ""}
                    inputMode="decimal"
                    disabled={disabled}
                    placeholder="未知"
                    onChange={(event) =>
                      update(index, { value: event.target.value })
                    }
                  />
                </td>
                <td>
                  <Select
                    aria-label={"POM " + (index + 1) + " 单位"}
                    {...errorProps("POM " + (index + 1) + " 单位", error)}
                    value={row.unit}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, {
                        unit: event.target.value as typeof row.unit,
                      })
                    }
                  >
                    <option value="cm">cm</option>
                    <option value="mm">mm</option>
                    <option value="in">in</option>
                  </Select>
                </td>
                <td>
                  <Input
                    aria-label={"POM " + (index + 1) + " 公差"}
                    {...errorProps("POM " + (index + 1) + " 公差", error)}
                    value={row.tolerance ?? ""}
                    inputMode="decimal"
                    disabled={disabled}
                    placeholder="未知"
                    onChange={(event) =>
                      update(index, { tolerance: event.target.value })
                    }
                  />
                </td>
                <td>
                  <Select
                    aria-label={"POM " + (index + 1) + " 依据"}
                    {...errorProps("POM " + (index + 1) + " 依据", error)}
                    value={row.source}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, {
                        source: event.target.value as typeof row.source,
                      })
                    }
                  >
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>
                  <input
                    aria-label={"POM " + (index + 1) + " 已复核"}
                    {...errorProps("POM " + (index + 1) + " 已复核", error)}
                    type="checkbox"
                    checked={row.reviewed}
                    disabled={disabled}
                    onChange={(event) =>
                      update(index, { reviewed: event.target.checked })
                    }
                  />
                </td>
                <td>
                  <Button
                    size="small"
                    disabled={disabled}
                    onClick={() =>
                      onChange(rows.filter((_, at) => at !== index))
                    }
                  >
                    移除
                  </Button>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7} className={styles.muted}>
                  尚未记录测量规格。图片不能确认实际尺寸。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
