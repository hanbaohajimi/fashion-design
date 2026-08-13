import { type CSSProperties, useLayoutEffect, useRef } from "react";
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

const NOTE_REFERENCE_WIDTH = 260;
const NOTE_REFERENCE_HEIGHT = 210;

export class NoteShapeUtil extends BaseBoxShapeUtil<NoteShape> {
  static override type = NOTE_SHAPE_TYPE;
  static override props: RecordProps<NoteShape> = {
    appearance: T.any.optional(),
    h: T.number,
    mounts: T.any.optional(),
    role: T.string,
    text: T.string,
    tone: T.string,
    w: T.number,
  };

  override getDefaultProps(): NoteShape["props"] {
    return {
      h: NOTE_REFERENCE_HEIGHT,
      role: "note",
      text: "记录轮廓、材质或需要继续探索的方向。",
      tone: "#f2d978",
      w: NOTE_REFERENCE_WIDTH,
    };
  }

  override isAspectRatioLocked(): boolean {
    return true;
  }

  override canResize(): boolean {
    return true;
  }

  override onTranslate = (shape: NoteShape) => {
    const hasMounts = shape.props.mounts && shape.props.mounts.length > 0;
    if (hasMounts) {
      return {
        id: shape.id,
        type: NOTE_SHAPE_TYPE,
        x: shape.x,
        y: shape.y,
      } as const;
    }
    return;
  };

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
  );

  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const lod = zoom < 0.3 ? "low" : zoom < 0.8 ? "medium" : "high";
  const noteScale =
    shape.props.w > 0 ? shape.props.w / NOTE_REFERENCE_WIDTH : 1;
  const sourceUrl = safeSourceUrl(shape.meta.source);
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const editorElement = textEditorRef.current;
    if (!editorElement) return;

    const overflowHeight = Math.ceil(
      editorElement.scrollHeight - editorElement.clientHeight,
    );
    if (overflowHeight <= 1) return;

    editor.updateShape({
      id: shape.id,
      type: NOTE_SHAPE_TYPE,
      props: {
        h: shape.props.h + overflowHeight + 1,
      },
    });
  }, [editor, noteScale, shape.id, shape.props.h, shape.props.text, sourceUrl]);

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

  const handleTextChange = (text: string): void => {
    editor.updateShape({
      id: shape.id,
      type: NOTE_SHAPE_TYPE,
      props: { text },
    });
  };

  const content = (
    <HTMLContainer
      className={styles.noteShape}
      style={
        {
          "--note-scale": noteScale,
          backgroundColor: shape.props.tone,
        } as CSSProperties
      }
    >
      <textarea
        aria-label="备注内容"
        className={styles.noteTextEditor}
        maxLength={1000}
        onChange={(event) => handleTextChange(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        ref={textEditorRef}
        spellCheck={false}
        value={shape.props.text}
      />
      {sourceUrl ? (
        <a
          className={styles.noteSourceLink}
          href={sourceUrl}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          rel="noreferrer"
          target="_blank"
        >
          查看趋势原文
        </a>
      ) : null}
    </HTMLContainer>
  );

  return (
    <MaterialShell
      annotation={<RoleBadge role={shape.props.role} shapeId={shape.id} />}
      annotationScale={noteScale}
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

function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
