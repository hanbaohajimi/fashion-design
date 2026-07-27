import {
  BOARD_ELEMENT_ROLES,
  type BoardElementRole,
} from "@fashion/shared";
import type { TLShape } from "tldraw";

export const IMAGE_SHAPE_TYPE = "fashion-image";
export const NOTE_SHAPE_TYPE = "fashion-note";
export const SWATCH_SHAPE_TYPE = "fashion-swatch";
export const FRAME_SHAPE_TYPE = "fashion-frame";

export const BOARD_ROLES = BOARD_ELEMENT_ROLES;
export type BoardRole = BoardElementRole;
export type RoleInferenceState = "none" | "pending" | "ready" | "failed";
export type RoleSource = "default" | "inferred" | "manual";

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [IMAGE_SHAPE_TYPE]: {
      fileId?: string;
      h: number;
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
      h: number;
      role: string;
      text: string;
      tone: string;
      w: number;
    };
    [SWATCH_SHAPE_TYPE]: {
      color: string;
      h: number;
      label: string;
      role: string;
      w: number;
    };
    [FRAME_SHAPE_TYPE]: {
      h: number;
      role: string;
      title: string;
      w: number;
    };
  }
}

export type ImageShape = TLShape<typeof IMAGE_SHAPE_TYPE>;
export type NoteShape = TLShape<typeof NOTE_SHAPE_TYPE>;
export type SwatchShape = TLShape<typeof SWATCH_SHAPE_TYPE>;
export type FrameShape = TLShape<typeof FRAME_SHAPE_TYPE>;
export type BoardShape = ImageShape | NoteShape | SwatchShape | FrameShape;

export function isBoardShape(shape: TLShape): shape is BoardShape {
  return (
    shape.type === IMAGE_SHAPE_TYPE ||
    shape.type === NOTE_SHAPE_TYPE ||
    shape.type === SWATCH_SHAPE_TYPE ||
    shape.type === FRAME_SHAPE_TYPE
  );
}

export function isRoleAssignableShape(
  shape: TLShape,
): shape is ImageShape | NoteShape | SwatchShape {
  return (
    shape.type === IMAGE_SHAPE_TYPE ||
    shape.type === NOTE_SHAPE_TYPE ||
    shape.type === SWATCH_SHAPE_TYPE
  );
}

export function normalizeBoardRole(role: string): BoardRole {
  if ((BOARD_ROLES as readonly string[]).includes(role)) {
    return role as BoardRole;
  }
  if (role === "palette") {
    return "palette";
  }
  if (role === "note" || role === "frame") {
    return "note";
  }
  return "style_ref";
}
