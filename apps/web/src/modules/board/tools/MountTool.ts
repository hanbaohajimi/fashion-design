import { StateNode, type TLPointerEventInfo, type TLShape } from "tldraw";

import { createUserMount, type Mount, type MountVariant } from "../shapes/material-appearance";
import {
  FABRIC_SHAPE_TYPE,
  IMAGE_SHAPE_TYPE,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
} from "../shapes/shape-types";

// ---------------------------------------------------------------------------
// Module-level active variant — shared with the ToolRail picker without
// threading a React context through tldraw's tool layer.
// ---------------------------------------------------------------------------
let activeVariant: MountVariant = "brass-pin";

export const getActiveMountVariant = (): MountVariant => activeVariant;
export const setActiveMountVariant = (variant: MountVariant): void => {
  activeVariant = variant;
};

// ---------------------------------------------------------------------------
// Mountable shapes — the four board shapes that carry a `mounts` prop
// ---------------------------------------------------------------------------
type MountableShapeType =
  | typeof IMAGE_SHAPE_TYPE
  | typeof NOTE_SHAPE_TYPE
  | typeof SWATCH_SHAPE_TYPE
  | typeof FABRIC_SHAPE_TYPE;

const MOUNTABLE_TYPES: readonly MountableShapeType[] = [
  IMAGE_SHAPE_TYPE,
  NOTE_SHAPE_TYPE,
  SWATCH_SHAPE_TYPE,
  FABRIC_SHAPE_TYPE,
];

function isMountable(
  shape: TLShape,
): shape is TLShape & { readonly type: MountableShapeType } {
  return (MOUNTABLE_TYPES as readonly string[]).includes(shape.type);
}

/**
 * Places a single mount on the shape under the pointer.
 *
 * `updateShape` is discriminated on `type`, so a shape whose type is only known
 * as a union can't be passed straight through. Switching on the literal narrows
 * it per branch, which lets the compiler verify that each target really does
 * carry a `mounts` prop — no cast required.
 */
export class MountTool extends StateNode {
  static override id = "mount";

  override onEnter = (): void => {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  };

  override onExit = (): void => {
    this.editor.setCursor({ type: "default", rotation: 0 });
  };

  override onPointerDown = (info: TLPointerEventInfo): void => {
    if (info.button !== 0) {
      return;
    }

    const point = this.editor.inputs.currentPagePoint;
    const hitShape = this.editor.getShapeAtPoint(point, {
      hitInside: true,
      margin: 0,
    });

    // Empty canvas or a shape that can't hold mounts — leave the tool.
    if (!hitShape || !isMountable(hitShape)) {
      this.editor.setCurrentTool("select");
      return;
    }

    const bounds = this.editor.getShapePageBounds(hitShape);
    if (!bounds) {
      return;
    }

    // Mount coordinates are stored normalised (0..1) against the content box so
    // they survive resizing.
    const clamp01 = (value: number): number =>
      Math.max(0, Math.min(1, value));
    const mount = createUserMount(
      activeVariant,
      clamp01((point.x - bounds.x) / bounds.w),
      clamp01((point.y - bounds.y) / bounds.h),
    );

    switch (hitShape.type) {
      case IMAGE_SHAPE_TYPE: {
        const shape = hitShape as TLShape & {
          readonly type: typeof IMAGE_SHAPE_TYPE;
          readonly props: { readonly mounts?: readonly Mount[] };
        };
        this.editor.updateShape({
          id: shape.id,
          type: IMAGE_SHAPE_TYPE,
          props: { mounts: [...(shape.props.mounts ?? []), mount] },
        });
        break;
      }
      case NOTE_SHAPE_TYPE: {
        const shape = hitShape as TLShape & {
          readonly type: typeof NOTE_SHAPE_TYPE;
          readonly props: { readonly mounts?: readonly Mount[] };
        };
        this.editor.updateShape({
          id: shape.id,
          type: NOTE_SHAPE_TYPE,
          props: { mounts: [...(shape.props.mounts ?? []), mount] },
        });
        break;
      }
      case SWATCH_SHAPE_TYPE: {
        const shape = hitShape as TLShape & {
          readonly type: typeof SWATCH_SHAPE_TYPE;
          readonly props: { readonly mounts?: readonly Mount[] };
        };
        this.editor.updateShape({
          id: shape.id,
          type: SWATCH_SHAPE_TYPE,
          props: { mounts: [...(shape.props.mounts ?? []), mount] },
        });
        break;
      }
      case FABRIC_SHAPE_TYPE: {
        const shape = hitShape as TLShape & {
          readonly type: typeof FABRIC_SHAPE_TYPE;
          readonly props: { readonly mounts?: readonly Mount[] };
        };
        this.editor.updateShape({
          id: shape.id,
          type: FABRIC_SHAPE_TYPE,
          props: { mounts: [...(shape.props.mounts ?? []), mount] },
        });
        break;
      }
    }

    // One click places one mount, then hands control back to select.

    // One click places one mount, then hands control back to select.
    this.editor.setCurrentTool("select");
  };

  override onKeyDown = (info: { readonly key: string }): void => {
    if (info.key === "Escape") {
      this.editor.setCurrentTool("select");
    }
  };
}
