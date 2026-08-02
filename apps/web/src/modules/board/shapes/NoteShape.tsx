import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
  useEditor,
  useValue,
} from "tldraw";

import { RoleBadge } from "./RoleBadge";
import { NOTE_SHAPE_TYPE, type NoteShape, normalizeBoardRole } from "./shape-types";
import { MaterialShell } from "./MaterialShell";
import { generateMaterialAppearance, resolveMaterialAppearance } from "./material-appearance";
import styles from "./shapes.module.css";

export class NoteShapeUtil extends BaseBoxShapeUtil<NoteShape> {
  static override type = NOTE_SHAPE_TYPE;
  static override props: RecordProps<NoteShape> = {
    appearance: T.any.optional(),
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
    return <NoteShapeContent shape={shape} />;
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

function NoteShapeContent({ shape }: { readonly shape: NoteShape }) {
  const editor = useEditor();
  const role = normalizeBoardRole(shape.props.role);
  const seed = parseInt(shape.id.replace(/\D/g, "").slice(0, 8)) || 12345;
  const appearance = shape.props.appearance ?? generateMaterialAppearance(
    resolveMaterialAppearance(role),
    seed,
    role,
  );

  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const lod = zoom < 0.3 ? "low" : zoom < 0.8 ? "medium" : "high";

  const content = (
    <HTMLContainer
      className={styles.noteShape}
      style={{ backgroundColor: shape.props.tone }}
    >
      <RoleBadge role={shape.props.role} />
      <p>{shape.props.text}</p>
      <span className={styles.shapeIndex}>NOTE / 01</span>
    </HTMLContainer>
  );

  return (
    <MaterialShell
      appearance={appearance}
      width={shape.props.w}
      height={shape.props.h}
      lod={lod}
    >
      {content}
    </MaterialShell>
  );
}
