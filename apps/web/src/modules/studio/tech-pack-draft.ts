import { studioTechPackSchema, type StudioTechPack } from "@fashion/shared";

// Local React identity only; works on HTTP previews without secure-context APIs.
const rowIdPrefix = Date.now().toString(36);
let rowSequence = 0;
export function createTechPackRowId(): string {
  return `tech-row-${rowIdPrefix}-${rowSequence++}`;
}

export type BomDraft = Omit<StudioTechPack["bom"][number], "quantity"> & {
  uiId: string;
  quantity: string;
};
export type PomDraft = Omit<
  StudioTechPack["pom"][number],
  "value" | "tolerance"
> & { uiId: string; value: string; tolerance: string };
export type TechPackDraft = Omit<StudioTechPack, "bom" | "pom"> & {
  bom: BomDraft[];
  pom: PomDraft[];
};

export function createTechPackDraft(value: StudioTechPack): TechPackDraft {
  return {
    ...value,
    bom: value.bom.map((row) => ({
      ...row,
      uiId: createTechPackRowId(),
      quantity: row.quantity === null ? "" : String(row.quantity),
    })),
    pom: value.pom.map((row) => ({
      ...row,
      uiId: createTechPackRowId(),
      value: row.value === null ? "" : String(row.value),
      tolerance: row.tolerance === null ? "" : String(row.tolerance),
    })),
  };
}

export class TechPackDraftError extends Error {
  constructor(
    message: string,
    readonly chapter: string,
    readonly label: string,
  ) {
    super(message);
  }
}

function number(
  value: string,
  label: string,
  chapter: string,
  zero = false,
): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Decimal/exponent notation only: reject partial exponents, hex and Infinity.
  const parsed = Number(trimmed);
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(trimmed) ||
    !Number.isFinite(parsed) ||
    (zero ? parsed < 0 : parsed <= 0)
  ) {
    throw new TechPackDraftError(
      `${label}需为${zero ? "非负" : "大于零的"}有限数值，未知请留空。`,
      chapter,
      label,
    );
  }
  return parsed;
}

/** Strip UI identities; never fall back to an older valid numeric value. */
export function serializeTechPackDraft(draft: TechPackDraft): StudioTechPack {
  return {
    ...draft,
    bom: draft.bom.map(({ uiId, quantity, ...row }, index) => {
      void uiId;
      return {
        ...row,
        quantity: number(quantity, `BOM ${index + 1} 用量`, "bom"),
      };
    }),
    pom: draft.pom.map(({ uiId, value, tolerance, ...row }, index) => {
      void uiId;
      return {
        ...row,
        value: number(value, `POM ${index + 1} 尺寸`, "pom"),
        tolerance: number(tolerance, `POM ${index + 1} 公差`, "pom", true),
      };
    }),
  };
}

export function validateTechPack(payload: StudioTechPack): void {
  const result = studioTechPackSchema.safeParse(payload);
  if (result.success) return;
  const issue = result.error.issues[0];
  const field = String(issue?.path[0] ?? "name");
  const row = typeof issue?.path[1] === "number" ? issue.path[1] + 1 : 1;
  const key = String(issue?.path[2] ?? "");
  const labels: Record<string, string> = {
    name: field === "pom" ? "部位" : "名称",
    unit: "单位",
    material: "材料",
    supplier: "供应商",
  };
  const table = field === "bom" || field === "pom";
  const label = table
    ? `${field.toUpperCase()} ${row} ${labels[key] ?? key}`
    : field === "name"
      ? "技术包名称"
      : "";
  throw new TechPackDraftError(
    `${label || "技术资料"}不符合填写规则，请检查必填内容和长度。`,
    table
      ? field
      : field === "name" || field === "styleRevisionId"
        ? "basics"
        : field,
    label,
  );
}
