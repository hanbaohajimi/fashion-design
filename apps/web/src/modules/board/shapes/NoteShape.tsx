import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
} from "tldraw";

import { RoleBadge } from "./RoleBadge";
import { NOTE_SHAPE_TYPE, type NoteShape } from "./shape-types";
import styles from "./shapes.module.css";

export class NoteShapeUtil extends BaseBoxShapeUtil<NoteShape> {
  static override type = NOTE_SHAPE_TYPE;
  static override props: RecordProps<NoteShape> = {
    h: T.number,
    role: T.string,
    text: T.string,
    tone: T.string,
    w: T.number,
  };

  override getDefaultProps(): NoteShape["props"] {
    return {
      h: 210,
      role: "note",
      text: "记录轮廓、材质或需要继续探索的方向。",
      tone: "#f2d978",
      w: 260,
    };
  }

  override component(shape: NoteShape) {
    return (
      <HTMLContainer
        className={styles.noteShape}
        style={{ backgroundColor: shape.props.tone }}
      >
        <RoleBadge role={shape.props.role} />
        <p>{shape.props.text}</p>
        <span className={styles.shapeIndex}>NOTE / 01</span>
      </HTMLContainer>
    );
  }

  override getText(shape: NoteShape): string {
    return shape.props.text;
  }

  override getIndicatorPath(shape: NoteShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
