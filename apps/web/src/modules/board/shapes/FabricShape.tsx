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
  FABRIC_SHAPE_TYPE,
  type FabricShape,
  normalizeBoardRole,
} from "./shape-types";
import { computeAnnotationScale, MaterialShell } from "./MaterialShell";
import {
  generateMaterialAppearance,
  resolveMaterialAppearance,
} from "./material-appearance";
import { deriveShapeSeed } from "./fabric-silhouette";
import { generateEdgePath } from "./edge-path";
import styles from "./shapes.module.css";

export class FabricShapeUtil extends BaseBoxShapeUtil<FabricShape> {
  static override type = FABRIC_SHAPE_TYPE;
  static override props: RecordProps<FabricShape> = {
    appearance: T.any.optional(),
    fabricId: T.string,
    fabricTags: T.arrayOf(T.string),
    h: T.number,
    mounts: T.any.optional(),
    role: T.string,
    thumbnailUrl: T.string,
    w: T.number,
  };

  override getDefaultProps(): FabricShape["props"] {
    return {
      fabricId: "",
      fabricTags: ["面料"],
      // Landscape — a real offcut is wider than it is tall.
      h: 174,
      role: "fabric_ref",
      thumbnailUrl: "",
      w: 260,
    };
  }

  override canResize(): boolean {
    return true;
  }

  override onTranslate = (shape: FabricShape) => {
    const hasMounts = shape.props.mounts && shape.props.mounts.length > 0;
    if (hasMounts) {
      return {
        id: shape.id,
        type: FABRIC_SHAPE_TYPE,
        x: shape.x,
        y: shape.y,
      } as const;
    }
    return;
  };

  override component(shape: FabricShape) {
    return <FabricShapeContent shape={shape} />;
  }

  override getIndicatorPath(shape: FabricShape): Path2D {
    // Follow the pinked edge, not a rectangle.
    const seed = deriveShapeSeed(shape.id);
    const d = generateEdgePath(seed, shape.props.w, shape.props.h, "pinked", 1);
    return new Path2D(d);
  }
}

function FabricShapeContent({ shape }: { readonly shape: FabricShape }) {
  const editor = useEditor();
  const role = normalizeBoardRole(shape.props.role);

  // FNV-1a seed: stable across renders, reloads and collaborators.
  const seed = deriveShapeSeed(shape.id);

  const appearance =
    shape.props.appearance ??
    generateMaterialAppearance(resolveMaterialAppearance(role), seed);

  // Override edge style to pinked — matches the .fabric clip-path from
  // natural_fabric_pinboard_demo.html: clean uniform zigzag on all four sides.
  const pinkAppearance = {
    ...appearance,
    edge: { style: "pinked" as const, intensity: appearance.edge.intensity },
  };

  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const lod = zoom < 0.3 ? "low" : zoom < 0.8 ? "medium" : "high";

  const handleRemoveMount = (mountId: string): void => {
    const nextMounts = (shape.props.mounts ?? []).filter(
      (m) => m.id !== mountId,
    );
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      props: {
        mounts: nextMounts,
      },
    });
  };

  // Full-bleed photo fills the entire irregular silhouette — no card chrome.
  const content = (
    <HTMLContainer className={styles.fabricSwatch}>
      {shape.props.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={shape.props.fabricTags.join("、")}
          draggable={false}
          src={shape.props.thumbnailUrl}
          className={styles.fabricSwatchImage}
        />
      ) : (
        <div className={styles.fabricSwatchEmpty}>
          <span>FABRIC</span>
        </div>
      )}
    </HTMLContainer>
  );

  return (
    <div className={styles.fabricSwatchWrapper}>
      <MaterialShell
        annotation={<RoleBadge role={shape.props.role} shapeId={shape.id} />}
        annotationScale={computeAnnotationScale(
          shape.props.w,
          shape.props.h,
          260,
          174,
        )}
        appearance={pinkAppearance}
        width={shape.props.w}
        height={shape.props.h}
        lod={lod}
        userMounts={shape.props.mounts}
        onRemoveMount={handleRemoveMount}
      >
        {content}
      </MaterialShell>
    </div>
  );
}
