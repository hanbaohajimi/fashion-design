import { useId } from "react";
import { imageTextPixelRect } from "@fashion/shared";
import type { ImageSize } from "./ImageViewer";
import { changedImageText, imageTextEditProblem } from "./image-text-editor";
import type { useImageTextEditor } from "./use-image-text-editor";
import styles from "./image-text.module.css";
import workspace from "./image-workspace.module.css";

export function ImageTextControls({
  editor,
  size,
  locked,
  busy,
  onSubmit,
}: {
  editor: ReturnType<typeof useImageTextEditor>;
  size: ImageSize | null;
  locked: boolean;
  busy: boolean;
  onSubmit: () => void;
}) {
  const fieldId = useId();
  const { draft, selected } = editor;
  const problem = imageTextEditProblem(draft, size);
  const unavailable = !size || size.width > 2048 || size.height > 2048;
  const disabled = locked || editor.scanning || !editor.ready || unavailable;
  const changes = changedImageText(draft.regions);
  const focusInput = (element: HTMLTextAreaElement) =>
    element.scrollIntoView({ block: "center", inline: "nearest" });
  return (
    <>
      <div className={styles.content}>
        <p>先识别文字，再选择区域改写。检查框选范围，选区外画面会保留。</p>
        <fieldset className={styles.controls} disabled={disabled}>
          <legend className={workspace.srOnly}>图片文字设置</legend>
          <div className={styles.pair}>
            <button
              type="button"
              disabled={draft.regions.length > 0}
              onClick={() => void editor.scan()}
            >
              {editor.scanning ? "正在识别…" : "识别图片文字"}
            </button>
            <button
              type="button"
              disabled={draft.regions.length >= 24}
              onClick={editor.add}
            >
              手动添加区域
            </button>
          </div>
          {draft.regions.length ? (
            <>
              <div
                className={styles.regionList}
                role="group"
                aria-label="选择文字区域"
              >
                {draft.regions.map((region, index) => (
                  <button
                    type="button"
                    key={region.id}
                    aria-pressed={region.id === draft.selected}
                    onClick={() => editor.select(region.id)}
                  >
                    <span>{index + 1}</span>
                    <span>
                      {region.original ||
                        region.replacement ||
                        "手动添加的文字"}
                    </span>
                    {region.original !== region.replacement ? (
                      <small>已修改</small>
                    ) : null}
                  </button>
                ))}
              </div>
              {selected ? (
                <div className={styles.selected}>
                  <label>
                    <span id={`${fieldId}-original`}>原文</span>
                    <textarea
                      aria-labelledby={`${fieldId}-original`}
                      value={selected.original}
                      maxLength={300}
                      rows={2}
                      onFocus={(event) => focusInput(event.currentTarget)}
                      onChange={(event) =>
                        editor.update(selected.id, {
                          original: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    <span id={`${fieldId}-replacement`}>替换为</span>
                    <textarea
                      aria-labelledby={`${fieldId}-replacement`}
                      value={selected.replacement}
                      maxLength={300}
                      rows={3}
                      onFocus={(event) => focusInput(event.currentTarget)}
                      onChange={(event) =>
                        editor.update(selected.id, {
                          replacement: event.target.value,
                        })
                      }
                      placeholder="输入新文案；留空则移除原文"
                    />
                  </label>
                  <small>
                    原文若识别有误，可以直接纠正。检查框选范围是否完整覆盖旧文字，并为新文案留出空间。
                  </small>
                  {size ? (
                    <small>
                      区域{" "}
                      {
                        imageTextPixelRect(
                          selected.rect,
                          size.width,
                          size.height,
                        ).width
                      }{" "}
                      ×{" "}
                      {
                        imageTextPixelRect(
                          selected.rect,
                          size.width,
                          size.height,
                        ).height
                      }{" "}
                      px
                    </small>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => editor.remove(selected.id)}
                  >
                    移除此区域
                  </button>
                </div>
              ) : null}
              <details className={styles.help}>
                <summary>调整选区与重新识别</summary>
                <p>
                  拖动文字框移动，右下角调整大小。方向键微调 1 px，Shift 为 10
                  px；拖动时 Escape 撤回。最多识别 24 处，一次修改 8 处。
                </p>
                <button type="button" onClick={editor.clear}>
                  清空全部文字区域
                </button>
              </details>
            </>
          ) : null}
        </fieldset>
        {editor.error ? (
          <p role="alert">{editor.error}</p>
        ) : editor.notice ? (
          <p role="status">{editor.notice}</p>
        ) : null}
      </div>
      <div className={styles.actions}>
        <small>
          {problem ??
            `将修改 ${changes.length} 处文字，生成后请核对字形与排版。`}
        </small>
        <button
          className={workspace.primary}
          type="button"
          disabled={disabled || Boolean(problem)}
          onClick={onSubmit}
        >
          {busy ? "正在提交…" : "生成文字修改版本"}
        </button>
      </div>
    </>
  );
}
