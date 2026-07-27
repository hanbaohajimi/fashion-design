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
import { IMAGE_SHAPE_TYPE, type ImageShape } from "./shape-types";
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

  return (
    <HTMLContainer className={styles.imageShape}>
      <div className={styles.imagePlaceholder}>
        <span>IMAGE / CDN</span>
      </div>
      {isNearViewport && (shape.props.url || uploadPreview) ? (
        // CDN URLs are supplied by persisted asset data.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          draggable={false}
          loading="lazy"
          src={shape.props.url || uploadPreview}
        />
      ) : null}
      <RoleBadge role={shape.props.role} />
      {(shape.props.uploadStatus ?? "ready") !== "ready" ? (
        <span
          className={styles.uploadStatus}
          data-status={shape.props.uploadStatus}
        >
          {shape.props.uploadStatus === "failed" ? "上传失败" : "正在处理"}
        </span>
      ) : null}
      <strong>{shape.props.title || "未命名图片"}</strong>
    </HTMLContainer>
  );
}

export class ImageShapeUtil extends BaseBoxShapeUtil<ImageShape> {
  static override type = IMAGE_SHAPE_TYPE;
  static override props: RecordProps<ImageShape> = {
    assetId: T.string.optional(),
    fileId: T.string.optional(),
    h: T.number,
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

  override component(shape: ImageShape) {
    return <ImageShapeContent shape={shape} />;
  }

  override getIndicatorPath(shape: ImageShape): Path2D {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }
}
