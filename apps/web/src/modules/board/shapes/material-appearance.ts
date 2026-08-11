import type { BoardElementRole } from "@fashion/shared";

export type SubstrateMaterial =
  "paper" | "photo" | "card" | "fabric" | "tracing-paper";

export type EdgeStyle =
  | "straight"
  | "torn"
  | "deckled"
  | "pinked"
  | "rough-cut"
  /** Unfinished cloth offcut: slanted sides, uneven waves, frayed threads. */
  | "raw-cut";

export type MountType = "pin" | "tape" | "clip" | "staple" | "stitch";

export type MountVariant =
  | "brass-pin"
  | "red-pin"
  | "silver-clip"
  | "washi-tape"
  | "masking-tape"
  | "binder-clip"
  | "staple-corner"
  | "running-stitch";

/**
 * A user-placed mount fastener.
 * x and y are normalized 0..1 relative to the shape's content area (width × height).
 */
export interface Mount {
  readonly id: string;
  readonly type: MountType;
  readonly variant: MountVariant;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly action?: "lock" | "draft" | "group" | "avoid";
}

export interface SubstrateConfig {
  readonly material: SubstrateMaterial;
  readonly tone: string;
  readonly textureId?: string;
  readonly opacity: number;
  readonly padding: number;
}

export interface EdgeConfig {
  readonly style: EdgeStyle;
  readonly intensity: number;
}

export interface ShadowConfig {
  readonly elevation: number;
  readonly softness: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface ImperfectionConfig {
  readonly crease: number;
  readonly grain: number;
  readonly cornerWear: number;
}

export type MaterialPreset =
  | "editorial-photo"
  | "sketch-paper"
  | "fabric-swatch"
  | "color-card"
  | "archive-note"
  | "clean-sheet";

export interface MaterialAppearance {
  readonly preset: MaterialPreset;
  readonly substrate: SubstrateConfig;
  readonly edge: EdgeConfig;
  /** Legacy: always empty for new boards. User mounts live in shape.props.mounts. */
  readonly mounts: readonly Mount[];
  readonly shadow: ShadowConfig;
  readonly imperfections: ImperfectionConfig;
  readonly seed: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a user-placed mount with normalized 0..1 coordinates.
 */
export function createUserMount(
  variant: MountVariant,
  normalizedX: number,
  normalizedY: number,
  rotation?: number,
): Mount {
  const r = rotation ?? Math.random() * 360;
  const type: MountType = variant.includes("pin")
    ? "pin"
    : variant.includes("tape")
      ? "tape"
      : "clip";
  return {
    id: `um-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    variant,
    x: Math.max(0, Math.min(1, normalizedX)),
    y: Math.max(0, Math.min(1, normalizedY)),
    rotation: r,
  };
}

/**
 * Resolve material appearance from board element role.
 */
export function resolveMaterialAppearance(
  role: BoardElementRole,
): MaterialPreset {
  switch (role) {
    case "style_ref":
    case "garment_ref":
    case "reference_garment":
      return "editorial-photo";
    case "fabric_ref":
      return "fabric-swatch";
    case "palette":
      return "color-card";
    case "silhouette_ref":
      return "sketch-paper";
    case "detail_ref":
      return "editorial-photo";
    case "note":
      return "archive-note";
    case "avoid":
      return "editorial-photo";
    default:
      return "clean-sheet";
  }
}

/**
 * Generate deterministic material appearance from preset and seed.
 * User mounts are no longer auto-generated here — they live in shape.props.mounts.
 */
export function generateMaterialAppearance(
  preset: MaterialPreset,
  seed: number,
): MaterialAppearance {
  const seededRandom = (offset: number): number => {
    const x = Math.sin(seed + offset) * 10000;
    return x - Math.floor(x);
  };

  const base = PRESET_CONFIGS[preset];

  return {
    preset,
    substrate: { ...base.substrate },
    edge: {
      ...base.edge,
      intensity: base.edge.intensity * (0.8 + seededRandom(12) * 0.4),
    },
    mounts: [], // always empty — user mounts live in shape.props.mounts
    shadow: {
      ...base.shadow,
      offsetX: base.shadow.offsetX * (0.9 + seededRandom(13) * 0.2),
      offsetY: base.shadow.offsetY * (0.9 + seededRandom(14) * 0.2),
    },
    imperfections: {
      crease: base.imperfections.crease * seededRandom(15),
      grain: base.imperfections.grain * (0.7 + seededRandom(16) * 0.6),
      cornerWear: base.imperfections.cornerWear * seededRandom(17),
    },
    seed,
  };
}

interface PresetConfig {
  readonly substrate: SubstrateConfig;
  readonly edge: EdgeConfig;
  readonly shadow: ShadowConfig;
  readonly imperfections: ImperfectionConfig;
}

const PRESET_CONFIGS: Record<MaterialPreset, PresetConfig> = {
  "editorial-photo": {
    substrate: { material: "photo", tone: "#f8f6f2", opacity: 1, padding: 12 },
    edge: { style: "straight", intensity: 0.8 },
    shadow: { elevation: 3, softness: 12, offsetX: 8, offsetY: 12 },
    imperfections: { crease: 0.05, grain: 0.25, cornerWear: 0.12 },
  },
  "sketch-paper": {
    substrate: {
      material: "paper",
      tone: "#f4f1ea",
      opacity: 0.98,
      padding: 16,
    },
    edge: { style: "torn", intensity: 2.0 },
    shadow: { elevation: 2, softness: 8, offsetX: 6, offsetY: 10 },
    imperfections: { crease: 0.18, grain: 0.45, cornerWear: 0.28 },
  },
  "fabric-swatch": {
    // padding 0 keeps the silhouette in the same coordinate space as the photo,
    // so one clip path serves both. The shadow stays tight to the pinked edge —
    // it reads as cloth thickness resting on the board, not a floating card.
    // Substrate opacity 0: only the fabric photo is visible, no backing layer.
    substrate: { material: "fabric", tone: "#cdbca2", opacity: 0, padding: 0 },
    edge: { style: "pinked", intensity: 1 },
    shadow: { elevation: 1, softness: 2.4, offsetX: 1.2, offsetY: 2 },
    imperfections: { crease: 0.1, grain: 0.55, cornerWear: 0 },
  },
  "color-card": {
    substrate: { material: "card", tone: "#fdfcfa", opacity: 1, padding: 8 },
    edge: { style: "straight", intensity: 0.5 },
    shadow: { elevation: 1, softness: 6, offsetX: 4, offsetY: 6 },
    imperfections: { crease: 0.02, grain: 0.15, cornerWear: 0.05 },
  },
  "archive-note": {
    substrate: {
      material: "paper",
      tone: "#f2ede3",
      opacity: 0.96,
      padding: 14,
    },
    edge: { style: "deckled", intensity: 1.8 },
    shadow: { elevation: 2, softness: 9, offsetX: 6, offsetY: 10 },
    imperfections: { crease: 0.15, grain: 0.4, cornerWear: 0.22 },
  },
  "clean-sheet": {
    substrate: { material: "paper", tone: "#ffffff", opacity: 1, padding: 0 },
    edge: { style: "straight", intensity: 0 },
    shadow: { elevation: 1, softness: 4, offsetX: 2, offsetY: 2 },
    imperfections: { crease: 0, grain: 0, cornerWear: 0 },
  },
};
