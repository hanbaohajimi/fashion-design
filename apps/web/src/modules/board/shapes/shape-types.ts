import type { TLShape } from "tldraw";

export const IMAGE_SHAPE_TYPE = "fashion-image";
export const NOTE_SHAPE_TYPE = "fashion-note";
export const SWATCH_SHAPE_TYPE = "fashion-swatch";
export const FRAME_SHAPE_TYPE = "fashion-frame";

export const BOARD_ROLES = [
  "reference",
  "note",
  "palette",
  "frame",
  "output",
] as const;

export type BoardRole = (typeof BOARD_ROLES)[number];

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    [IMAGE_SHAPE_TYPE]: {
      h: number;
      role: string;
      title: string;
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
