import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
  useEditor,
  useValue,
} from "tldraw";
import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import { RoleBadge } from "./RoleBadge";
import {
  SWATCH_SHAPE_TYPE,
  type SwatchShape,
  normalizeBoardRole,
} from "./shape-types";
import { MaterialShell } from "./MaterialShell";
import {
  generateMaterialAppearance,
  resolveMaterialAppearance,
} from "./material-appearance";
import {
  SWATCH_HEIGHT,
  SWATCH_MAX_COLORS,
  computeSwatchWidth,
  createSwatchColor,
  deriveNextSwatchColor,
  getSwatchColors,
  nextSwatchColorLabel,
  normalizeSwatchHex,
  type SwatchColor,
} from "./swatch-colors";
import styles from "./shapes.module.css";

export class SwatchShapeUtil extends BaseBoxShapeUtil<SwatchShape> {
  static override type = SWATCH_SHAPE_TYPE;
  static override props: RecordProps<SwatchShape> = {
    appearance: T.any.optional(),
    color: T.string,
    colors: T.any.optional(),
    h: T.number,
    label: T.string,
    mounts: T.any.optional(),
    role: T.string,
    w: T.number,
  };

  // Adding a colour changes the card's natural aspect ratio. Once that natural
  // size is established, user resizing behaves like an image and stays uniform.
  override isAspectRatioLocked(): boolean {
    return true;
  }

  override getDefaultProps(): SwatchShape["props"] {
    return {
      color: "#c8ab84",
      colors: [createSwatchColor("#c8ab84", "OAT")],
      h: SWATCH_HEIGHT,
      label: "OAT",
      role: "palette",
      w: computeSwatchWidth(1),
    };
  }

  override canResize(): boolean {
    return true;
  }

  override onTranslate = (shape: SwatchShape) => {
    const hasMounts = shape.props.mounts && shape.props.mounts.length > 0;
    if (hasMounts) {
      return {
        id: shape.id,
        type: SWATCH_SHAPE_TYPE,
        x: shape.x,
        y: shape.y,
      } as const;
    }
    return;
  };

  override component(shape: SwatchShape) {
    return <SwatchShapeContent shape={shape} />;
  }

  override getIndicatorPath(shape: SwatchShape): Path2D {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 6);
    return path;
  }
}

function SwatchShapeContent({ shape }: { readonly shape: SwatchShape }) {
  const editor = useEditor();
  const role = normalizeBoardRole(shape.props.role);
  const seed = parseInt(shape.id.replace(/\D/g, "").slice(0, 8)) || 12345;
  const appearance =
    shape.props.appearance ??
    generateMaterialAppearance(resolveMaterialAppearance(role), seed);

  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const lod = zoom < 0.3 ? "low" : zoom < 0.8 ? "medium" : "high";

  const colors = getSwatchColors(shape.props);
  const canAdd = colors.length < SWATCH_MAX_COLORS;
  const naturalWidth = computeSwatchWidth(colors.length);
  const swatchScale =
    naturalWidth > 0 && shape.props.w > 0 ? shape.props.w / naturalWidth : 1;
  const normalizedHeight = SWATCH_HEIGHT * swatchScale;

  // Repair legacy or freely-stretched cards using width as the authoritative
  // dimension. Future pointer resizing is aspect-locked by the shape util.
  useEffect(() => {
    if (Math.abs(shape.props.h - normalizedHeight) < 0.5) {
      return;
    }
    editor.updateShape({
      id: shape.id,
      type: SWATCH_SHAPE_TYPE,
      props: { h: normalizedHeight },
    });
  }, [editor, normalizedHeight, shape.id, shape.props.h]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftColors, setDraftColors] = useState<Record<string, string>>({});

  /**
   * Writes the colour list back, mirroring entry 0 onto the scalar `color` /
   * `label` props that the role inspector and palette API still read, and
   * resizing the card to the new colour count.
   */
  const commitColors = (next: readonly SwatchColor[]): void => {
    const head = next[0];
    editor.updateShape({
      id: shape.id,
      type: SWATCH_SHAPE_TYPE,
      props: {
        color: head?.color ?? shape.props.color,
        colors: next,
        h: SWATCH_HEIGHT * swatchScale,
        label: head?.label ?? shape.props.label,
        w: computeSwatchWidth(next.length) * swatchScale,
      },
    });
  };

  // The picker is a controlled input, so each change writes straight through and
  // the chip repaints from the shape prop. Dragging through the spectrum can
  // leave several history entries, which undo collapses acceptably.
  const updateColorDraft = (id: string, raw: string): void => {
    // Keep the native picker controlled by local React state while it is open.
    // Writing only to the external tldraw store can briefly re-render the input
    // with its previous value while the Windows picker is editing the HEX field.
    setDraftColors((current) =>
      current[id] === raw ? current : { ...current, [id]: raw },
    );
  };

  const handleColorInput = (id: string, raw: string): void => {
    updateColorDraft(id, raw);
    const normalized = normalizeSwatchHex(raw);
    if (!normalized) {
      return;
    }
    commitColors(
      colors.map((entry) =>
        entry.id === id ? { ...entry, color: normalized } : entry,
      ),
    );
  };

  const handleColorBlur = (id: string): void => {
    setDraftColors((current) => {
      if (!(id in current)) {
        return current;
      }
      return Object.fromEntries(
        Object.entries(current).filter(([entryId]) => entryId !== id),
      );
    });
  };

  const handleAdd = (): void => {
    if (!canAdd) {
      return;
    }
    const base = colors[colors.length - 1]?.color ?? shape.props.color;
    commitColors([
      ...colors,
      createSwatchColor(
        deriveNextSwatchColor(base),
        nextSwatchColorLabel(colors.length),
      ),
    ]);
  };

  const handleRemove = (id: string): void => {
    if (colors.length <= 1) {
      return;
    }
    commitColors(colors.filter((entry) => entry.id !== id));
  };

  const handleLabelCommit = (id: string): void => {
    const trimmed = draftLabel.trim();
    setEditingId(null);
    if (!trimmed) {
      return;
    }
    commitColors(
      colors.map((entry) =>
        entry.id === id ? { ...entry, label: trimmed } : entry,
      ),
    );
  };

  // tldraw reads any pointerdown inside a shape as the start of a drag, so
  // interactive children have to stop it from reaching the canvas.
  const swallow = (event: PointerEvent | MouseEvent): void => {
    event.stopPropagation();
  };

  const headHex = (colors[0]?.color ?? shape.props.color).toUpperCase();

  const content = (
    <HTMLContainer
      className={styles.swatchShape}
      style={
        {
          "--swatch-scale": swatchScale,
        } as CSSProperties
      }
    >
      <div className={styles.swatchBody}>
        <div className={styles.swatchHeader}>
          <span className={styles.swatchHeaderHex}>{headHex}</span>
        </div>

        <div className={styles.swatchColorRow}>
          {colors.map((entry) => (
            <div
              key={entry.id}
              className={styles.swatchColorCell}
              onPointerEnter={() => setHoveredId(entry.id)}
              onPointerLeave={() => setHoveredId(null)}
            >
              <div
                className={styles.swatchChip}
                style={{ backgroundColor: entry.color }}
                title={`${entry.label} · ${entry.color.toUpperCase()}`}
              >
                <input
                  aria-label={`${entry.label} 颜色`}
                  className={styles.swatchColorInput}
                  onBlur={() => handleColorBlur(entry.id)}
                  onChange={(event) =>
                    updateColorDraft(entry.id, event.currentTarget.value)
                  }
                  onInput={(event: FormEvent<HTMLInputElement>) =>
                    handleColorInput(entry.id, event.currentTarget.value)
                  }
                  onPointerDown={swallow}
                  type="color"
                  value={draftColors[entry.id] ?? entry.color}
                />
                {hoveredId === entry.id && colors.length > 1 && (
                  <button
                    aria-label={`删除 ${entry.label}`}
                    className={styles.swatchRemove}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRemove(entry.id);
                    }}
                    onPointerDown={swallow}
                    title="删除此颜色"
                    type="button"
                  >
                    ✕
                  </button>
                )}
              </div>

              {editingId === entry.id ? (
                <input
                  aria-label="颜色名称"
                  autoFocus
                  className={styles.swatchLabelInput}
                  maxLength={16}
                  onBlur={() => handleLabelCommit(entry.id)}
                  onChange={(event) => setDraftLabel(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      handleLabelCommit(entry.id);
                    } else if (event.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                  onPointerDown={swallow}
                  value={draftLabel}
                />
              ) : (
                <span
                  className={styles.swatchLabel}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setDraftLabel(entry.label);
                    setEditingId(entry.id);
                  }}
                  onPointerDown={swallow}
                  title="双击重命名"
                >
                  {entry.label}
                </span>
              )}
            </div>
          ))}

          {canAdd && (
            <div className={styles.swatchAddCell}>
              <button
                aria-label="添加颜色"
                className={styles.swatchAdd}
                onClick={(event) => {
                  event.stopPropagation();
                  handleAdd();
                }}
                onPointerDown={swallow}
                title={`添加颜色（最多 ${SWATCH_MAX_COLORS} 个）`}
                type="button"
              >
                <svg fill="none" height="16" viewBox="0 0 16 16" width="16">
                  <path
                    d="M8 3.5v9M3.5 8h9"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="1.5"
                  />
                </svg>
              </button>
              {/* Keeps the button aligned with the chips, not the labels. */}
              <div aria-hidden="true" className={styles.swatchAddSpacer} />
            </div>
          )}
        </div>
      </div>
    </HTMLContainer>
  );

  return (
    <MaterialShell
      annotation={<RoleBadge role={shape.props.role} shapeId={shape.id} />}
      annotationScale={swatchScale}
      appearance={appearance}
      height={shape.props.h}
      lod={lod}
      onRemoveMount={(mountId) => {
        const nextMounts = (shape.props.mounts ?? []).filter(
          (mount) => mount.id !== mountId,
        );
        editor.updateShape({
          id: shape.id,
          type: SWATCH_SHAPE_TYPE,
          props: {
            mounts: nextMounts,
          },
        });
      }}
      userMounts={shape.props.mounts}
      width={shape.props.w}
    >
      {content}
    </MaterialShell>
  );
}
