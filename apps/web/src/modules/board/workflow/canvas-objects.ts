import type { Editor, TLShapeId } from "tldraw";

export interface CanvasObject {
  id: TLShapeId;
  parentId: string;
  index: string;
  type: string;
  name: string;
  isLocked: boolean;
  isHidden: boolean;
  assetId?: string;
}

export interface CanvasObjectRow extends CanvasObject {
  depth: number;
  hasChildren: boolean;
  ancestorLocked: boolean;
  ancestorHidden: boolean;
  label: string;
}

const names: Record<string, string> = {
  "fashion-image": "图片",
  "fashion-media": "媒体",
  "fashion-note": "便签",
  "fashion-swatch": "色卡",
  "fashion-frame": "画框",
  image: "图片",
  text: "文字",
  note: "便签",
  draw: "手绘",
  frame: "画框",
  group: "分组",
  arrow: "箭头",
  line: "线条",
  geo: "图形",
};

export function canvasObjectType(type: string) {
  return names[type] ?? "对象";
}

const cleanName = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 160);

/** Only list properties are observed; position, size and camera never enter the projection. */
export function readCanvasObjects(editor: Editor): CanvasObjectRow[] {
  return buildCanvasObjectTree(editor.getCurrentPageShapes().map(shape => {
    const props = shape.props as Record<string, unknown>;
    const value = ["text", "note"].includes(shape.type)
      ? editor.getShapeUtil(shape).getText(shape)
      : [props.title, props.text, props.label, props.name].find(item => typeof item === "string" && item.trim());
    return {
      id: shape.id,
      parentId: shape.parentId,
      index: shape.index,
      type: shape.type,
      name: typeof value === "string" ? cleanName(value) : "",
      isLocked: shape.isLocked,
      isHidden: shape.meta.canvasHidden === true,
      ...(shape.type === "fashion-image" && typeof props.assetId === "string" && props.assetId ? { assetId: props.assetId } : {}),
    };
  }));
}

/** Front-to-back siblings stay inside their original container, including during filtering. */
export function buildCanvasObjectTree(objects: readonly CanvasObject[]): CanvasObjectRow[] {
  const byId = new Map(objects.map(object => [object.id as string, object]));
  const children = new Map<string, CanvasObject[]>();
  const roots: CanvasObject[] = [];
  for (const object of objects) {
    if (byId.has(object.parentId) && object.parentId !== object.id) {
      const siblings = children.get(object.parentId) ?? [];
      siblings.push(object);
      children.set(object.parentId, siblings);
    } else roots.push(object);
  }
  const frontFirst = (a: CanvasObject, b: CanvasObject) =>
    a.index === b.index ? a.id.localeCompare(b.id) : a.index < b.index ? 1 : -1;
  roots.sort(frontFirst);
  for (const siblings of children.values()) siblings.sort(frontFirst);

  const rows: CanvasObjectRow[] = [];
  const visited = new Set<string>();
  const labels = new Map<string, string>();
  const occurrences = new Map<string, number>();
  // Names identify objects while stacking changes; numbering must not follow z-order.
  for (const object of [...objects].sort((a, b) => a.id.localeCompare(b.id))) {
    const name = cleanName(object.name) || canvasObjectType(object.type);
    const occurrence = (occurrences.get(name) ?? 0) + 1;
    occurrences.set(name, occurrence);
    labels.set(object.id, occurrence > 1 ? `${name}（${occurrence}）` : name);
  }
  const walk = (root: CanvasObject) => {
    const pending = [{ object: root, depth: 0, ancestorLocked: false, ancestorHidden: false }];
    while (pending.length) {
      const next = pending.pop();
      if (!next) break;
      const { object, depth, ancestorLocked, ancestorHidden } = next;
      if (visited.has(object.id)) continue;
      visited.add(object.id);
      const name = cleanName(object.name) || canvasObjectType(object.type);
      const descendants = children.get(object.id) ?? [];
      rows.push({ ...object, name, depth, ancestorLocked, ancestorHidden, hasChildren: descendants.length > 0,
        label: labels.get(object.id) ?? name });
      for (let i = descendants.length - 1; i >= 0; i--) {
        const descendant = descendants[i];
        if (descendant) pending.push({ object: descendant, depth: depth + 1,
          ancestorLocked: ancestorLocked || object.isLocked, ancestorHidden: ancestorHidden || object.isHidden });
      }
    }
  };
  roots.forEach(walk);
  // A stale or cyclic imported parent must not make objects disappear from the list.
  [...objects].sort(frontFirst).forEach(object => { if (!visited.has(object.id)) walk(object); });
  return rows;
}

const searchText = (text: string) => text.normalize("NFKC").toLocaleLowerCase().trim();

export function filterCanvasObjects(rows: readonly CanvasObjectRow[], query: string, collapsed: ReadonlySet<string>): CanvasObjectRow[] {
  const needle = searchText(query);
  if (needle) {
    const byId = new Map(rows.map(row => [row.id as string, row]));
    const visible = new Set<string>();
    const matchedContainers = new Set<string>();
    for (const row of rows) {
      if (searchText(`${row.label} ${canvasObjectType(row.type)}`).includes(needle) || matchedContainers.has(row.parentId)) {
        visible.add(row.id);
        if (row.hasChildren) matchedContainers.add(row.id);
        let parent = byId.get(row.parentId);
        const visited = new Set<string>([row.id]);
        while (parent && !visited.has(parent.id)) {
          visible.add(parent.id);
          visited.add(parent.id);
          parent = byId.get(parent.parentId);
        }
      }
    }
    return rows.filter(row => visible.has(row.id));
  }
  const hidden = new Set<string>();
  return rows.filter(row => {
    const hide = hidden.has(row.parentId) || collapsed.has(row.parentId);
    if (hide) hidden.add(row.id);
    return !hide;
  });
}

export type CanvasObjectOrder = "front" | "forward" | "backward" | "back";

/** Re-read permissions and locks at activation, so a stale open panel cannot mutate protected objects. */
export function orderCanvasObjects(editor: Editor, order: CanvasObjectOrder) {
  const selected = editor.getSelectedShapeIds();
  if (editor.getIsReadonly() || !selected.length || selected.some(id => editor.isShapeOrAncestorLocked(id) || editor.isShapeHidden(id))) return;
  editor.markHistoryStoppingPoint("调整对象层级");
  if (order === "front") editor.bringToFront(selected);
  if (order === "back") editor.sendToBack(selected);
  if (order === "forward") editor.bringForward(selected, { considerAllShapes: true });
  if (order === "backward") editor.sendBackward(selected, { considerAllShapes: true });
}
