import { useId, useState, type ReactNode } from "react";
import type { ImageRect, ImageSize } from "./ImageViewer";
import {
  initialOutpaintFrame,
  moveOutpaintFrame,
  outpaintProblem,
  resizeOutpaintFrame,
} from "./image-outpaint";
import styles from "./image-outpaint.module.css";
import workspace from "./image-workspace.module.css";

export function ImageOutpaintControls({
  frame,
  size,
  prompt,
  locked,
  busy,
  methodControl,
  onFrame,
  onPrompt,
  onSubmit,
}: {
  frame: ImageRect;
  size: ImageSize | null;
  prompt: string;
  locked: boolean;
  busy: boolean;
  methodControl: ReactNode;
  onFrame: (frame: ImageRect) => void;
  onPrompt: (prompt: string) => void;
  onSubmit: () => void;
}) {
  const hint = useId();
  const problemId = useId();
  const [input, setInput] = useState<{
    key: keyof ImageRect;
    text: string;
  } | null>(null);
  const problem = outpaintProblem(frame, size);
  const unavailable = !size || size.width > 2048 || size.height > 2048;
  const update = (value: ImageRect) => {
    setInput(null);
    onFrame(value);
  };
  const commitInput = () => {
    setInput(null);
    if (
      !input ||
      !size ||
      !input.text.trim() ||
      !Number.isFinite(Number(input.text))
    )
      return;
    const value = Number(input.text);
    update(
      input.key === "width" || input.key === "height"
        ? resizeOutpaintFrame(
            frame,
            size,
            input.key === "width" ? value : frame.width,
            input.key === "height" ? value : frame.height,
          )
        : moveOutpaintFrame(
            frame,
            size,
            input.key === "left" ? value : frame.left,
            input.key === "top" ? value : frame.top,
          ),
    );
  };
  return (
    <>
      <div className={styles.content}>
        {methodControl}
        <p>拖动原图安排位置，拉动右下角扩展画布。棋盘格区域将由 AI 补全。</p>
        <fieldset className={styles.controls} disabled={locked || unavailable}>
          <legend className={workspace.srOnly}>扩图设置</legend>
          <div className={styles.pair}>
            <button
              type="button"
              onClick={() => size && update(initialOutpaintFrame(size))}
            >
              四周留白
            </button>
            <button
              type="button"
              onClick={() =>
                size &&
                update(
                  moveOutpaintFrame(
                    frame,
                    size,
                    (frame.width - size.width) / 2,
                    (frame.height - size.height) / 2,
                  ),
                )
              }
            >
              原图居中
            </button>
          </div>
          <div className={styles.pair}>
            {(["width", "height", "left", "top"] as const).map((key) => (
              <label key={key}>
                {
                  {
                    width: "画布宽度",
                    height: "画布高度",
                    left: "原图左边距",
                    top: "原图上边距",
                  }[key]
                }
                <input
                  type="number"
                  inputMode="numeric"
                  min={key === "width" || key === "height" ? 256 : 0}
                  max={
                    key === "width" || key === "height"
                      ? 2048
                      : key === "left"
                        ? Math.max(0, frame.width - (size?.width ?? 0))
                        : Math.max(0, frame.height - (size?.height ?? 0))
                  }
                  step={key === "width" || key === "height" ? 16 : 1}
                  value={input?.key === key ? input.text : frame[key]}
                  aria-describedby={hint}
                  onFocus={(event) =>
                    event.currentTarget.scrollIntoView({
                      block: "center",
                      inline: "nearest",
                    })
                  }
                  onChange={(event) =>
                    setInput({ key, text: event.currentTarget.value })
                  }
                  onBlur={commitInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitInput();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setInput(null);
                    }
                  }}
                />
              </label>
            ))}
          </div>
          <small id={hint}>
            完成输入后，边长按 16 px 对齐，边距限定在画布内。
          </small>
          <label>
            扩图要求
            <textarea
              value={prompt}
              maxLength={1000}
              onFocus={(event) =>
                event.currentTarget.scrollIntoView({
                  block: "center",
                  inline: "nearest",
                })
              }
              onChange={(event) => onPrompt(event.target.value)}
            />
          </label>
          <details className={styles.help}>
            <summary>键盘操作与尺寸范围</summary>
            <p>
              聚焦原图后，方向键移动 1 px，Shift 加快至 10
              px；聚焦边界后，方向键调整 16 px，Shift 调整 64 px。拖动时按
              Escape 撤回。
            </p>
            <p>
              最长边 2048 px，至少 65.5 万像素，长宽比不超过
              3:1。原图区域与透明度会保留。
            </p>
          </details>
        </fieldset>
      </div>
      <div className={styles.actions}>
        <div className={styles.output}>
          <span>输出尺寸</span>
          <strong>
            {frame.width} × {frame.height} px
          </strong>
        </div>
        {problem ? (
          <p id={problemId} role="status">
            {problem}
          </p>
        ) : null}
        <button
          type="button"
          className={workspace.primary}
          disabled={locked || Boolean(problem)}
          aria-describedby={problem ? problemId : undefined}
          onClick={onSubmit}
        >
          {busy ? "正在提交…" : "生成扩图版本"}
        </button>
      </div>
    </>
  );
}
