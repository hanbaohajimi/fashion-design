import { BaseBoxShapeUtil, HTMLContainer, T, useEditor, useSvgExportContext, useValue, type TLShape } from "tldraw";
import styles from "./text-shape.module.css";
import nameStyles from "./canvas-node-name.module.css";

export const TEXT_SHAPE_TYPE = "fashion-text";
declare module "tldraw" { interface TLGlobalShapePropsMap { "fashion-text": { w: number; h: number; title: string; text: string } } }
export type TextShape = TLShape<typeof TEXT_SHAPE_TYPE>;
export class TextShapeUtil extends BaseBoxShapeUtil<TextShape> {
  static override type = TEXT_SHAPE_TYPE;
  static override props = { w: T.number, h: T.number, title: T.string, text: T.string };
  override getDefaultProps() { return { w: 360, h: 240, title: "文本", text: "" }; }
  override getText(shape: TextShape) { return shape.props.text; }
  override component(shape: TextShape) { return <TextContent shape={shape} />; }
  override getIndicatorPath(shape: TextShape) { const path = new Path2D(); path.roundRect(0, 0, shape.props.w, shape.props.h, 12); return path; }
}
function TextContent({ shape }: { shape: TextShape }) {
  const editor = useEditor();
  const exporting = Boolean(useSvgExportContext());
  const readonly = useValue(`text-readonly-${shape.id}`, () => editor.getIsReadonly() || editor.isShapeOrAncestorLocked(shape), [editor, shape.id]);
  const source = typeof shape.meta.source === "string" && /^https?:\/\//u.test(shape.meta.source) ? shape.meta.source : null;
  return <HTMLContainer className={styles.text} style={{ width: shape.props.w, height: shape.props.h }} aria-label={shape.props.title}>
    <header className={nameStyles.name} title={shape.props.title}>{shape.props.title}</header>
    {exporting ? <div className={styles.content}>{shape.props.text}</div> : <textarea aria-label="文本内容" value={shape.props.text} readOnly={readonly} maxLength={12000} placeholder="输入文本内容…" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onChange={event => editor.updateShape<TextShape>({ id: shape.id, type: TEXT_SHAPE_TYPE, props: { text: event.target.value } })} />}
    {source && !exporting ? <a href={source} rel="noreferrer" target="_blank" onPointerDown={event => event.stopPropagation()}>查看资料来源</a> : null}
  </HTMLContainer>;
}
