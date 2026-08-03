import {
  BaseBoxShapeUtil,
  Box,
  HTMLContainer,
  type RecordProps,
  T,
  useEditor,
  useValue,
} from "tldraw";

import { RoleBadge } from "./RoleBadge";
import { useUploadPreview } from "../upload-preview-store";
import { IMAGE_SHAPE_TYPE, type ImageShape, normalizeBoardRole } from "./shape-types";
import { computeAnnotationScale, MaterialShell } from "./MaterialShell";
import { generateMaterialAppearance, resolveMaterialAppearance } from "./material-appearance";
import styles from "./shapes.module.css";

function ImageShapeContent({ shape }: { readonly shape: ImageShape }) {
  const editor = useEditor();
  const uploadPreview = useUploadPreview(shape.id);
  const isNearViewport = useValue(
    `image-visible-${shape.id}`,
    () => {
      const bounds = editor.getShapePageBounds(shape);
      return bounds
        ? Box.Collides(editor.getViewportPageBounds(), bounds)
        : false;
    },
    [editor, shape.id],
  );

  const role = normalizeBoardRole(shape.props.role);
  const seed = parseInt(shape.id.replace(/\D/g, "").slice(0, 8)) || 12345;
  const appearance = shape.props.appearance ?? generateMaterialAppearance(
    resolveMaterialAppearance(role),
    seed,
  );

  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const lod = zoom < 0.3 ? "low" : zoom < 0.8 ? "medium" : "high";

  const handleRemoveMount = (mountId: string): void => {
    const nextMounts = (shape.props.mounts ?? []).filter((m) => m.id !== mountId);
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      props: {
        mounts: nextMounts,
      },
    });
  };

  const content = (
    <HTMLContainer className={styles.imageShape}>
      <div className={styles.imagePlaceholder}>
        <span>IMAGE / CDN</span>
      </div>
      {isNearViewport && (shape.props.url || uploadPreview) ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          draggable={false}
          loading="lazy"
          src={shape.props.url || uploadPreview}
        />
      ) : null}
      {(shape.props.uploadStatus ?? "ready") !== "ready" ? (
        <span
          className={styles.uploadStatus}
          data-status={shape.props.uploadStatus}
        >
          {shape.props.uploadStatus === "failed" ? "上传失败" : "正在处理"}
        </span>
      ) : null}
    </HTMLContainer>
  );

  return (
    <MaterialShell
      annotation={
        <RoleBadge
          label={role === "note" ? shape.props.roleLabel : undefined}
          role={shape.props.role}
          shapeId={shape.id}
        />
      }
      annotationScale={computeAnnotationScale(
        shape.props.w,
        shape.props.h,
        340,
        260,
      )}
      appearance={appearance}
      width={shape.props.w}
      height={shape.props.h}
      lod={lod}
      userMounts={shape.props.mounts}
      onRemoveMount={handleRemoveMount}
    >
      {content}
    </MaterialShell>
  );
}

export class ImageShapeUtil extends BaseBoxShapeUtil<ImageShape> {
  static override type = IMAGE_SHAPE_TYPE;
  static override props: RecordProps<ImageShape> = {
    appearance: T.any.optional(),
    assetId: T.string.optional(),
    fileId: T.string.optional(),
    h: T.number,
    mounts: T.any.optional(),
    role: T.string,
    roleConfidence: T.number.optional(),
    roleInferenceState: T.string.optional(),
    roleLabel: T.string.optional(),
    roleSource: T.string.optional(),
    title: T.string,
    uploadStatus: T.string.optional(),
    url: T.string,
    w: T.number,
  };

  override isAspectRatioLocked(): boolean {
    return true;
  }

  override getDefaultProps(): ImageShape["props"] {
    return {
      fileId: "",
      h: 260,
      role: "style_ref",
      roleConfidence: undefined,
      roleInferenceState: "none",
      roleLabel: undefined,
      roleSource: "default",
      title: "图片参考",
      uploadStatus: "ready",
      url: "",
      w: 340,
    };
  }

  override canCull(): boolean {
    return false;
  }

  override canResize(): boolean {
    return true;
  }

  override onTranslate = (shape: ImageShape) => {
    const hasMounts = shape.props.mounts && shape.props.mounts.length > 0;
    if (hasMounts) {
      return {
        id: shape.id,
        type: IMAGE_SHAPE_TYPE,
        x: shape.x,
        y: shape.y,
      } as const;
    }
    return;
  };

  override component(shape: ImageShape) {
    return <ImageShapeContent shape={shape} />;
  }

  override getIndicatorPath(shape: ImageShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
