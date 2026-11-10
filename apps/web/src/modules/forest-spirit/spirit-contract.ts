export type SpiritMotion = "idle" | "hover_greet" | "drag_hold" | "put_down";
export type SpiritPhase = "loading" | "idle" | "hovering" | "pressing" | "dragArmed" | "dragging" | "settling" | "hidden" | "error" | "disposed";
export interface SpiritAnchor { xRatio: number; yRatio: number }
export interface SpiritPoint { x: number; y: number }

/** Render inputs only. These fields never confer production approval. */
export interface SpiritRenderAsset {
  model3Url: string;
  coreUrl: string;
  runtimeModuleUrl: string;
  hitArea: { viewBox: [number, number]; polygons: number[][][] };
  motions: Record<SpiritMotion, string>;
}

/** Production gate, separate from Cubism model3.json and the reference specifications. */
export interface ReadySpiritAsset extends SpiritRenderAsset {
  schemaVersion: 1;
  status: "ready";
  characterId: "forest-spirit-front-v8";
  visualReview: { approved: true; noEyelashes: true; crossEyeHighlights: true };
  hitArea: { approved: true; viewBox: [number, number]; polygons: number[][][] };
}

export interface SpiritRenderer {
  load(asset: SpiritRenderAsset, signal: AbortSignal): Promise<void>;
  play(motion: SpiritMotion, options?: { interrupt?: boolean; reducedMotion?: boolean }): Promise<void>;
  pause(): void;
  resume(): void;
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;
  dispose(): void;
}
export type SpiritRendererFactory = (canvas: HTMLCanvasElement) => SpiritRenderer;

/** No subscription or automatic generation is enabled by this event contract. */
export interface SpiritTaskEvent {
  projectId: string;
  conversationId: string;
  taskId: string;
  kind: "completed" | "failed";
  resultId?: string;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const localAssetUrl = (value: unknown): value is string => typeof value === "string" && /^\/(?!\/)[^?#\\]+$/u.test(value) && !value.split("/").some(part => part === ".." || part === ".");

/** Structural render inputs only; never converts an unreviewed package into ReadySpiritAsset. */
export function parseSpiritRenderAsset(value: unknown): SpiritRenderAsset | null {
  if (!record(value)) return null;
  if (![value.model3Url, value.coreUrl, value.runtimeModuleUrl].every(localAssetUrl)) return null;
  const hit = value.hitArea;
  if (!record(hit) || !Array.isArray(hit.viewBox) || hit.viewBox.length !== 2 || !hit.viewBox.every(n => typeof n === "number" && Number.isFinite(n) && n > 0)) return null;
  const [width, height] = hit.viewBox as [number, number];
  if (!Array.isArray(hit.polygons) || !hit.polygons.length || hit.polygons.length > 64) return null;
  for (const polygon of hit.polygons) {
    if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 512) return null;
    if (!polygon.every(point => Array.isArray(point) && point.length === 2 && point.every(n => typeof n === "number" && Number.isFinite(n)) && point[0] >= 0 && point[0] <= width && point[1] >= 0 && point[1] <= height)) return null;
    const area = polygon.reduce((total, point, index) => { const next = polygon[(index + 1) % polygon.length]; return total + point[0] * next[1] - next[0] * point[1]; }, 0);
    if (Math.abs(area) < 1) return null;
  }
  if (!record(value.motions) || !(["idle", "hover_greet", "drag_hold", "put_down"] as const).every(name => localAssetUrl((value.motions as Record<string, unknown>)[name]))) return null;
  return value as unknown as SpiritRenderAsset;
}

/** A missing/review-pending package never enables a character or a substitute image. */
export function parseReadySpiritAsset(value: unknown): ReadySpiritAsset | null {
  if (!record(value) || value.schemaVersion !== 1 || value.status !== "ready" || value.characterId !== "forest-spirit-front-v8") return null;
  const review = value.visualReview;
  if (!record(review) || review.approved !== true || review.noEyelashes !== true || review.crossEyeHighlights !== true) return null;
  if (!record(value.hitArea) || value.hitArea.approved !== true || !parseSpiritRenderAsset(value)) return null;
  return value as unknown as ReadySpiritAsset;
}

const clampRatio = (value: number) => Math.max(0, Math.min(1, value));
export const DEFAULT_SPIRIT_ANCHOR: SpiritAnchor = { xRatio: 1, yRatio: 1 };
export function readSpiritAnchor(storageKey: string): SpiritAnchor {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (record(value) && typeof value.xRatio === "number" && Number.isFinite(value.xRatio) && typeof value.yRatio === "number" && Number.isFinite(value.yRatio)) return { xRatio: clampRatio(value.xRatio), yRatio: clampRatio(value.yRatio) };
  } catch { /* Optional position preference; the existing assistant stays usable. */ }
  return { ...DEFAULT_SPIRIT_ANCHOR };
}
export function anchorToPoint(anchor: SpiritAnchor, available: SpiritPoint): SpiritPoint {
  return { x: clampRatio(anchor.xRatio) * Math.max(0, available.x), y: clampRatio(anchor.yRatio) * Math.max(0, available.y) };
}
export function pointToAnchor(point: SpiritPoint, available: SpiritPoint, previous: SpiritAnchor): SpiritAnchor {
  return { xRatio: available.x > 0 ? clampRatio(point.x / available.x) : previous.xRatio, yRatio: available.y > 0 ? clampRatio(point.y / available.y) : previous.yRatio };
}
