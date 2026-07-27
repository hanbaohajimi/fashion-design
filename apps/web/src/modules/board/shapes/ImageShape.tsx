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
import {
  IMAGE_SHAPE_TYPE,
  type ImageShape,
} from "./shape-types";
import styles from "./shapes.module.css";

function ImageShapeContent({ shape }: { readonly shape: ImageShape }) {
  const editor = useEditor();
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
      {isNearViewport && shape.props.url ? (
        // CDN URLs are supplied by persisted asset data.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          draggable={false}
          loading="lazy"
          src={shape.props.url}
        />
      ) : null}
      <RoleBadge role={shape.props.role} />
      <strong>{shape.props.title || "未命名图片"}</strong>
    </HTMLContainer>
  );
}

export class ImageShapeUtil extends BaseBoxShapeUtil<ImageShape> {
  static override type = IMAGE_SHAPE_TYPE;
  static override props: RecordProps<ImageShape> = {
    h: T.number,
    role: T.string,
    title: T.string,
    url: T.string,
    w: T.number,
  };

  override getDefaultProps(): ImageShape["props"] {
    return {
      h: 260,
      role: "reference",
      title: "图片参考",
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
