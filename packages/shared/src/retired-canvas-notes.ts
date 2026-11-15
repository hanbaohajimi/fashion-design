type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
type Material = { id: string; type: string; title: string; payload?: JsonObject };

/** Retired notes cannot be restored by an old browser draft or layout snapshot.
 * Business documents formerly rendered as notes keep their identity and layout.
 */
export function retireCanvasNotes(snapshot: JsonObject, materials: readonly Material[] = [], bindings: readonly { shapeId: string; nodeId: string }[] = []) {
  const nodes = new Map(materials.map(node => [node.id, node]));
  const bound = new Map(bindings.map(binding => [binding.shapeId, binding.nodeId]));
  const removedShapeIds = new Set<string>();
  const cleanRecord = (value: unknown): unknown => {
    const record = object(value);
    if (record.typeName !== "shape" || !["fashion-note", "note"].includes(String(record.type))) return value;
    const props = object(record.props);
    const node = nodes.get(String(bound.get(String(record.id)) ?? object(record.meta).canvasNodeId ?? ""));
    if (node && node.type !== "reference_text" && !node.payload?.retiredNote) return { ...record, type: "fashion-text", props: {
      w: Number(props.w) || 280, h: Number(props.h) || 220,
      text: String(node.payload?.text ?? node.payload?.summary ?? props.text ?? node.title), title: node.title,
    } };
    if (typeof record.id === "string") removedShapeIds.add(record.id);
    return null;
  };
  const stores = [object(object(snapshot.document).store), object(snapshot.store)];
  const cleaned = stores.map(store => Object.fromEntries(Object.entries(store).map(([id, value]) => [id, cleanRecord(value)]).filter(([, value]) => value !== null)));
  const legacy = Array.isArray(snapshot.legacyRecords) ? snapshot.legacyRecords.map(cleanRecord).filter(record => record !== null) : undefined;
  const removeBindings = (store: JsonObject) => Object.fromEntries(Object.entries(store).filter(([, value]) => {
    const record = object(value);
    return record.typeName !== "binding" || !removedShapeIds.has(String(record.fromId)) && !removedShapeIds.has(String(record.toId));
  }));
  const next: JsonObject = { ...snapshot,
    ...(snapshot.document ? { document: { ...object(snapshot.document), store: removeBindings(cleaned[0] ?? {}) } } : {}),
    ...(snapshot.store ? { store: removeBindings(cleaned[1] ?? {}) } : {}),
    ...(legacy ? { legacyRecords: legacy } : {}),
  };
  return { snapshot: next, removedShapeIds: [...removedShapeIds] };
}
