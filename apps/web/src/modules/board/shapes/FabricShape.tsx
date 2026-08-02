import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
  useEditor,
  useValue,
} from "tldraw";

import { RoleBadge } from "./RoleBadge";
import { FABRIC_SHAPE_TYPE, type FabricShape, normalizeBoardRole } from "./shape-types";
import { MaterialShell } from "./MaterialShell";
import { generateMaterialAppearance, resolveMaterialAppearance } from "./material-appearance";
import styles from "./shapes.module.css";

export class FabricShapeUtil extends BaseBoxShapeUtil<FabricShape> {
  static override type = FABRIC_SHAPE_TYPE;
  static override props: RecordProps<FabricShape> = {
    appearance: T.any.optional(),
    fabricCategory: T.string,
    fabricId: T.string,
    fabricName: T.string,
    h: T.number,
    role: T.string,
    thumbnailUrl: T.string,
    w: T.number,
  };

  override getDefaultProps(): FabricShape["props"] {
    return {
      fabricCategory: "fabric",
      fabricId: "",
      fabricName: "未命名面料",
      h: 280,
      role: "fabric_ref",
      thumbnailUrl: "",
      w: 240,
    };
  }

  override component(shape: FabricShape) {
    return <FabricShapeContent shape={shape} />;
  }

  override getIndicatorPath(shape: FabricShape): Path2D {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 16);
    return path;
  }
}

function FabricShapeContent({ shape }: { readonly shape: FabricShape }) {
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
    <HTMLContainer className={styles.fabricShape}>
      <div className={styles.fabricShapeVisual}>
        {shape.props.thumbnailUrl ? (
          // The source is the authenticated fabric image endpoint.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" draggable={false} src={shape.props.thumbnailUrl} />
        ) : (
          <span>FABRIC / ARCHIVE</span>
        )}
      </div>
      <RoleBadge role="fabric_ref" />
      <div className={styles.fabricShapeMeta}>
        <span>{shape.props.fabricCategory}</span>
        <strong>{shape.props.fabricName}</strong>
      </div>
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
