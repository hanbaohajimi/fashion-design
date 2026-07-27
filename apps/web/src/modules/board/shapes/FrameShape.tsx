import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
} from "tldraw";

import { RoleBadge } from "./RoleBadge";
import { FRAME_SHAPE_TYPE, type FrameShape } from "./shape-types";
import styles from "./shapes.module.css";

export class FrameShapeUtil extends BaseBoxShapeUtil<FrameShape> {
  static override type = FRAME_SHAPE_TYPE;
  static override props: RecordProps<FrameShape> = {
    h: T.number,
    role: T.string,
    title: T.string,
    w: T.number,
  };

  override getDefaultProps(): FrameShape["props"] {
    return {
      h: 520,
      role: "frame",
      title: "系列方向",
      w: 760,
    };
  }

  override component(shape: FrameShape) {
    return (
      <HTMLContainer className={styles.frameShape}>
        <div className={styles.frameTitle}>
          <RoleBadge role={shape.props.role} />
          <strong>{shape.props.title}</strong>
        </div>
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: FrameShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
