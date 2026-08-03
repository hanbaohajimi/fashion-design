import {
  BOARD_ELEMENT_ROLES,
  type BoardElementRole,
} from "@fashion/shared";
import type { TLShape } from "tldraw";
import type { MaterialAppearance, Mount } from "./material-appearance";
import type { SwatchColor } from "./swatch-colors";

export const IMAGE_SHAPE_TYPE = "fashion-image";
export const NOTE_SHAPE_TYPE = "fashion-note";
export const SWATCH_SHAPE_TYPE = "fashion-swatch";
export const FRAME_SHAPE_TYPE = "fashion-frame";
export const FABRIC_SHAPE_TYPE = "fashion-fabric";

export const BOARD_ROLES = BOARD_ELEMENT_ROLES;
export type BoardRole = BoardElementRole;
export type RoleInferenceState = "none" | "pending" | "ready" | "failed";
export type RoleSource = "default" | "inferred" | "manual";

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [IMAGE_SHAPE_TYPE]: {
      appearance?: MaterialAppearance;
      assetId?: string;
      fileId?: string;
      h: number;
      mounts?: readonly Mount[];
      role: string;
      roleConfidence?: number | undefined;
      roleInferenceState?: string | undefined;
      roleLabel?: string | undefined;
      roleSource?: string | undefined;
      title: string;
      uploadStatus?: string;
      url: string;
      w: number;
    };
    [NOTE_SHAPE_TYPE]: {
      appearance?: MaterialAppearance;
      h: number;
      mounts?: readonly Mount[];
      role: string;
      text: string;
      tone: string;
      w: number;
    };
    [SWATCH_SHAPE_TYPE]: {
      appearance?: MaterialAppearance;
      /** Mirrors `colors[0].color` — kept for the role inspector and palette API. */
      color: string;
      colors?: readonly SwatchColor[];
      h: number;
      /** Mirrors `colors[0].label`. */
      label: string;
      mounts?: readonly Mount[];
      role: string;
      w: number;
    };
    [FRAME_SHAPE_TYPE]: {
      h: number;
      role: string;
      title: string;
      w: number;
    };
    [FABRIC_SHAPE_TYPE]: {
      appearance?: MaterialAppearance;
      fabricCategory: string;
      fabricId: string;
      fabricName: string;
      h: number;
      mounts?: readonly Mount[];
      role: string;
      thumbnailUrl: string;
      w: number;
    };
  }
}

export type ImageShape = TLShape<typeof IMAGE_SHAPE_TYPE>;
export type NoteShape = TLShape<typeof NOTE_SHAPE_TYPE>;
export type SwatchShape = TLShape<typeof SWATCH_SHAPE_TYPE>;
export type FrameShape = TLShape<typeof FRAME_SHAPE_TYPE>;
export type FabricShape = TLShape<typeof FABRIC_SHAPE_TYPE>;
export type BoardShape = ImageShape | NoteShape | SwatchShape | FrameShape | FabricShape;

export function isBoardShape(shape: TLShape): shape is BoardShape {
  return (
    shape.type === IMAGE_SHAPE_TYPE ||
    shape.type === NOTE_SHAPE_TYPE ||
    shape.type === SWATCH_SHAPE_TYPE ||
    shape.type === FRAME_SHAPE_TYPE ||
    shape.type === FABRIC_SHAPE_TYPE
  );
}

export function isRoleAssignableShape(
  shape: TLShape,
): shape is ImageShape | NoteShape | SwatchShape | FabricShape {
  return (
    shape.type === IMAGE_SHAPE_TYPE ||
    shape.type === NOTE_SHAPE_TYPE ||
    shape.type === SWATCH_SHAPE_TYPE ||
    shape.type === FABRIC_SHAPE_TYPE
  );
}

export function normalizeBoardRole(role: string): BoardRole {
  if ((BOARD_ROLES as readonly string[]).includes(role)) {
    return role as BoardRole;
  }
  if (role === "palette") return "palette";
  if (role === "note" || role === "frame") return "note";
  return "style_ref";
}

export function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  const withHash = normalized.startsWith("#") ? normalized : `#${normalized}`;
  return /^#[0-9A-F]{6}$/u.test(withHash) ? withHash : null;
}
