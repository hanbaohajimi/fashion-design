import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
} from "tldraw";

import { RoleBadge } from "./RoleBadge";
import {
  SWATCH_SHAPE_TYPE,
  type SwatchShape,
} from "./shape-types";
import styles from "./shapes.module.css";

export class SwatchShapeUtil extends BaseBoxShapeUtil<SwatchShape> {
  static override type = SWATCH_SHAPE_TYPE;
  static override props: RecordProps<SwatchShape> = {
    color: T.string,
    h: T.number,
    label: T.string,
    role: T.string,
    w: T.number,
  };

  override isAspectRatioLocked(): boolean {
    return true;
  }

  override getDefaultProps(): SwatchShape["props"] {
    return {
      color: "#d94f2b",
      h: 180,
      label: "Signal Red",
      role: "palette",
      w: 180,
    };
  }

  override component(shape: SwatchShape) {
    return (
      <HTMLContainer className={styles.swatchShape}>
        <div
          className={styles.swatchColor}
          style={{ backgroundColor: shape.props.color }}
        />
        <RoleBadge role={shape.props.role} />
        <div className={styles.swatchMeta}>
          <strong>{shape.props.label}</strong>
          <span>{shape.props.color.toUpperCase()}</span>
        </div>
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: SwatchShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
