import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
  useEditor,
  useValue,
} from "tldraw";

import { RoleBadge } from "./RoleBadge";
import {
  SWATCH_SHAPE_TYPE,
  type SwatchShape,
  normalizeBoardRole,
} from "./shape-types";
import { MaterialShell } from "./MaterialShell";
import { generateMaterialAppearance, resolveMaterialAppearance } from "./material-appearance";
import styles from "./shapes.module.css";

export class SwatchShapeUtil extends BaseBoxShapeUtil<SwatchShape> {
  static override type = SWATCH_SHAPE_TYPE;
  static override props: RecordProps<SwatchShape> = {
    appearance: T.any.optional(),
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
    return <SwatchShapeContent shape={shape} />;
  }

  override getIndicatorPath(shape: SwatchShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}

function SwatchShapeContent({ shape }: { readonly shape: SwatchShape }) {
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
