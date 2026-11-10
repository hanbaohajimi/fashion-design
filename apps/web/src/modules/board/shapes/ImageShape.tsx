import {
  BaseBoxShapeUtil,
  Box,
  HTMLContainer,
  type RecordProps,
  T,
  useEditor,
  useSvgExportContext,
  useValue,
} from "tldraw";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCanvasInteraction } from "../workflow/canvas-interaction-context";
import { readCanvasImageDimensions } from "../workflow/canvas-image-sizing";
import { preparedCanvasImage } from "../workflow/canvas-export-images";

import { RoleBadge } from "./RoleBadge";
import { useUploadPreview } from "../upload-preview-store";
import { CandidateLightbox } from "../generation/CandidateLightbox";
import type { GenerationCandidate } from "../generation/generation-types";
import {
  IMAGE_SHAPE_TYPE,
  type ImageShape,
  normalizeImageRole,
} from "./shape-types";
import { computeAnnotationScale, MaterialShell } from "./MaterialShell";
import {
  generateMaterialAppearance,
  resolveMaterialAppearance,
} from "./material-appearance";
import styles from "./shapes.module.css";

function ImageShapeContent({ shape }: { readonly shape: ImageShape }) {
  const editor = useEditor();
  const canvas = useCanvasInteraction();
  const exportContext = useSvgExportContext();
  const [inpaintOpen, setInpaintOpen] = useState(false);
  const uploadPreview = useUploadPreview(shape.id);
  const source = shape.props.url || uploadPreview;
  const [retry, setRetry] = useState(0);
  const imageKey = `${retry}:${source ?? ""}`;
  const currentImageKey = useRef(imageKey);
  useLayoutEffect(() => { currentImageKey.current = imageKey; }, [imageKey]);
  const [imageState, setImageState] = useState<
    { key: string; status: "ready"; width: number; height: number } | { key: string; status: "failed" } | null
  >(null);
  const imageReady = imageState?.key === imageKey && imageState.status === "ready";
  const imageFailed = imageState?.key === imageKey && imageState.status === "failed";
  const readOnly = useValue(`image-readonly-${shape.id}`, () => editor.getIsReadonly(), [editor, shape.id]);
  useEffect(() => {
    if (exportContext || readOnly || imageState?.status !== "ready" || imageState.key !== imageKey || !source) return;
    const current = editor.getShape<ImageShape>(shape.id);
    if (!current || current.props.url !== source ||
      (current.props.imageSource === source && current.props.imageWidth === imageState.width && current.props.imageHeight === imageState.height)) return;
    editor.store.mergeRemoteChanges(() => editor.run(() => editor.updateShape({
      id: shape.id, type: "fashion-image", props: { imageWidth: imageState.width, imageHeight: imageState.height, imageSource: source },
    }), { ignoreShapeLock: true, history: "ignore" }));
  }, [editor, exportContext, imageKey, imageState, readOnly, shape.id, source]);
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

  const role = normalizeImageRole(shape.props.role, shape.props);
  const isSelected = useValue(
    `image-selected-${shape.id}`,
    () => editor.getOnlySelectedShapeId() === shape.id,
    [editor, shape.id],
  );
  const inpaintCandidate: GenerationCandidate | null =
    role === "garment_ref" && shape.props.assetId && shape.props.url
      ? {
          assetId: shape.props.assetId,
          height: shape.props.h,
          id: shape.props.generationCandidateId ?? `canvas:${shape.id}`,
          taskId: shape.props.generationTaskId ?? `canvas:${shape.id}`,
          taskType: "t2i",
          url: shape.props.url,
          width: shape.props.w,
        }
      : null;
  const seed = parseInt(shape.id.replace(/\D/g, "").slice(0, 8)) || 12345;
  const appearance =
    shape.props.appearance ??
    generateMaterialAppearance(resolveMaterialAppearance(role), seed);

  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const lod = zoom < 0.3 ? "low" : zoom < 0.8 ? "medium" : "high";
  const generationStatus = shape.props.generationStatus;
  const isGenerationPlaceholder = Boolean(
    shape.props.generationTaskId && !shape.props.url,
  );
  const generationStatusLabel = generationStatus
    ? (GENERATION_STATUS_LABELS[generationStatus] ?? generationStatus)
    : "正在生成";
  const isGenerationInProgress =
    !generationStatus ||
    generationStatus === "queued" ||
    generationStatus === "running";

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

  const content = (
    <HTMLContainer className={styles.imageShape} role="group" aria-label={shape.props.title} data-canvas-node-id={typeof shape.meta.canvasNodeId === "string" ? shape.meta.canvasNodeId : undefined}>
      {isGenerationPlaceholder ? (
        <div
          aria-label={generationStatusLabel}
          className={styles.generationPlaceholder}
          data-status={generationStatus}
          role="status"
        >
          {isGenerationInProgress ? (
            <div aria-hidden="true" className={styles.generationFlow}>
              <i />
              <i />
              <i />
            </div>
          ) : (
            <div className={styles.generationFailure}>
              <strong>{generationStatusLabel}</strong>
              {shape.props.generationError ? (
                <small>{shape.props.generationError}</small>
              ) : null}
            </div>
          )}
        </div>
      ) : (!source || (!exportContext && !imageReady)) ? (
        <div className={styles.imagePlaceholder}>
          <span>{imageFailed ? "图片暂不可用" : source ? "正在载入图片" : "图片尚未就绪"}</span>
          {imageFailed ? <button type="button" onPointerDown={event => event.stopPropagation()} onClick={event => {
            event.stopPropagation(); setRetry(value => value + 1);
          }}>重新加载图片</button> : null}
        </div>
      ) : null}
      {(exportContext || isNearViewport) &&
      source ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={imageKey}
          alt=""
          draggable={false}
          hidden={!exportContext && imageFailed}
          loading={exportContext ? "eager" : "lazy"}
          src={exportContext ? preparedCanvasImage(editor, source) : source}
          onError={() => { if (!exportContext && currentImageKey.current === imageKey) setImageState({ key: imageKey, status: "failed" }); }}
          onLoad={event => {
            if (exportContext || currentImageKey.current !== imageKey) return;
            const size = readCanvasImageDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
            if (size) setImageState({ key: imageKey, status: "ready", ...size });
          }}
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
    <>
      <MaterialShell
        annotation={
          <div className={styles.roleBadgeActions}>
            <RoleBadge
              label={role === "note" ? shape.props.roleLabel : undefined}
              role={role}
              shapeId={shape.id}
            />
            {isSelected && !readOnly && !exportContext && inpaintCandidate ? (
              <button
                aria-label="局部更改成衣"
                className={styles.inpaintTrigger}
                onClick={(event) => {
                  event.stopPropagation();
                  if (canvas) canvas.open(shape.id);
                  else setInpaintOpen(true);
                }}
                onDoubleClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                局部更改
              </button>
            ) : null}
          </div>
        }
        annotationScale={Math.max(1.2, computeAnnotationScale(
          shape.props.w,
          shape.props.h,
          340,
          260,
        ))}
        appearance={appearance}
        width={shape.props.w}
        height={shape.props.h}
        lod={lod}
        userMounts={shape.props.mounts}
        onRemoveMount={handleRemoveMount}
      >
        {content}
      </MaterialShell>
      {inpaintOpen && inpaintCandidate ? (
        <CandidateLightbox
          candidate={inpaintCandidate}
          initialMode="inpaint"
          onClose={() => setInpaintOpen(false)}
        />
      ) : null}
    </>
  );
}

export class ImageShapeUtil extends BaseBoxShapeUtil<ImageShape> {
  static override type = IMAGE_SHAPE_TYPE;
  static override props: RecordProps<ImageShape> = {
    appearance: T.any.optional(),
    assetId: T.string.optional(),
    fileId: T.string.optional(),
    generationCandidateId: T.string.optional(),
    generationError: T.string.optional(),
    generationPrompt: T.string.optional(),
    generationStatus: T.string.optional(),
    generationTaskId: T.string.optional(),
    h: T.number,
    imageWidth: T.number.optional(),
    imageHeight: T.number.optional(),
    imageSource: T.string.optional(),
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

const GENERATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  canceled: "生成已停止",
  failed: "生成失败",
  moderation_failed: "未通过内容审核",
  queued: "正在排队",
  running: "正在生成",
  succeeded: "生成完成",
};
