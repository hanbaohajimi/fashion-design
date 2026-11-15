const retiredPurposes = new Set([
  "avoid", "detail_ref", "fabric_ref", "fabric_texture", "garment_ref", "note", "palette", "palette_ref", "reference_garment", "silhouette_ref", "style_ref",
]);
const retiredKeys = new Set(["roleLabel", "roleSource", "roleInferenceState", "roleConfidence", "referenceRole", "referenceWeight", "referenceStrength"]);
const retiredPreference = (value: unknown) => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.origin === "inferred" && /(?:style_ref|silhouette_ref|fabric_ref|fabric_texture|detail_ref|garment_ref|reference_garment|roleInference|roleSource|素材用途标签|参考图角色|参考权重|自动用途标签)/u.test(`${String(item.text ?? "")} ${String(item.sourceQuote ?? "")}`);
};

/** Project model-facing copies without mutating historical records or authorization roles. */
export function withoutMaterialPurpose<T>(value: T): T {
  const clean = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.filter((entry) => !retiredPreference(entry)).map(clean);
    if (!item || typeof item !== "object") return item;
    const record = item as Record<string, unknown>;
    const retiredRole = typeof record.role === "string" && retiredPurposes.has(record.role);
    return Object.fromEntries(Object.entries(record).flatMap(([key, entry]) => {
      if (retiredKeys.has(key) || (key === "role" && retiredRole) || (key === "weight" && retiredRole)) return [];
      return [[key, clean(entry)]];
    }));
  };
  return clean(value) as T;
}
