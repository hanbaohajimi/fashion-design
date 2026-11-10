import {
  rotatedImageSize,
  imageTransformSchema,
  type ImageTransform,
} from "@fashion/shared";
import { useId, useState } from "react";
import type { ImageSize } from "./ImageViewer";
import { WorkspaceIcon } from "./WorkspaceIcon";
import {
  hasOrientationChange,
  originalOrientation,
  turnImage,
  type ImageOrientation,
} from "./image-orientation";
import styles from "./image-orientation.module.css";
import workspaceStyles from "./image-workspace.module.css";

export function ImageOrientationControls({
  value,
  onChange,
  size,
  busy,
  pending,
  comparing,
  onCompare,
  onSave,
}: {
  value: ImageOrientation;
  onChange: (value: ImageOrientation) => void;
  size: ImageSize | null;
  busy: boolean;
  pending: boolean;
  comparing: boolean;
  onCompare: (value: boolean) => void;
  onSave: (params: ImageTransform) => void;
}) {
  const angleId = useId();
  const outputId = useId();
  const angleHintId = useId();
  const [angleDraft, setAngleDraft] = useState<string | null>(null);
  const angleInvalid =
    angleDraft !== null &&
    (!angleDraft.trim() ||
      !Number.isFinite(Number(angleDraft)) ||
      Number(angleDraft) < -180 ||
      Number(angleDraft) > 180);
  const changed = hasOrientationChange(value);
  const output = size
    ? rotatedImageSize(size.width, size.height, value.rotate)
    : null;
  const params = output
    ? imageTransformSchema.safeParse({
        ...value,
        ...output,
        prompt: "旋转与翻转图片",
      })
    : null;
  const invalid = params && !params.success;
  const update = (next: ImageOrientation) => {
    setAngleDraft(null);
    onCompare(false);
    onChange(next);
  };
  return (
    <>
      <div className={styles.content} role="group" aria-label="方向调整参数">
        <p className={styles.intro}>
          调整方向，实时预览。保存后会得到一张新版本，原图保留。
        </p>
        <fieldset
          className={styles.controls}
          disabled={busy || pending || !size}
        >
          <legend className={workspaceStyles.srOnly}>旋转与镜像设置</legend>
          <div className={styles.group}>
            <span className={styles.label}>旋转</span>
            <div className={styles.pair}>
              <button
                type="button"
                onClick={() => update(turnImage(value, -90))}
                aria-label="向左旋转 90 度"
              >
                <WorkspaceIcon name="rotate_left" />
                向左 90°
              </button>
              <button
                type="button"
                onClick={() => update(turnImage(value, 90))}
                aria-label="向右旋转 90 度"
              >
                <WorkspaceIcon name="orient" />
                向右 90°
              </button>
            </div>
          </div>
          <div className={styles.group}>
            <div className={styles.angleRow}>
              <label htmlFor={angleId}>旋转角度</label>
              <div className={styles.angleInput}>
                <input
                  id={angleId}
                  type="number"
                  inputMode="decimal"
                  min={-180}
                  max={180}
                  step={0.1}
                  value={angleDraft ?? value.rotate}
                  aria-invalid={angleInvalid || undefined}
                  aria-describedby={angleInvalid ? angleHintId : undefined}
                  onChange={(event) => {
                    const angle = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(angle) && angle >= -180 && angle <= 180)
                      update({ ...value, rotate: angle });
                    setAngleDraft(event.currentTarget.value);
                  }}
                  onBlur={() => setAngleDraft(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "Escape") {
                      event.preventDefault();
                      setAngleDraft(null);
                    }
                  }}
                />
                <span aria-hidden="true">°</span>
              </div>
            </div>
            <input
              type="range"
              aria-label="拖动调整旋转角度"
              min={-180}
              max={180}
              step={1}
              value={value.rotate}
              onChange={(event) =>
                update({ ...value, rotate: Number(event.target.value) })
              }
            />
            {angleInvalid ? (
              <small id={angleHintId}>请输入 −180° 至 180° 的角度。</small>
            ) : null}
          </div>
          <div className={styles.group}>
            <span className={styles.label}>镜像</span>
            <div className={styles.pair}>
              <button
                type="button"
                aria-pressed={value.flipHorizontal}
                onClick={() =>
                  update({ ...value, flipHorizontal: !value.flipHorizontal })
                }
              >
                <WorkspaceIcon name="flip_horizontal" />
                水平翻转
              </button>
              <button
                type="button"
                aria-pressed={value.flipVertical}
                onClick={() =>
                  update({ ...value, flipVertical: !value.flipVertical })
                }
              >
                <WorkspaceIcon name="flip_vertical" />
                垂直翻转
              </button>
            </div>
          </div>
          <div className={styles.pair}>
            <button
              type="button"
              disabled={!changed}
              aria-pressed={comparing}
              onClick={() => onCompare(!comparing)}
            >
              <WorkspaceIcon name="image" />
              {comparing ? "返回预览" : "查看原图"}
            </button>
            <button
              type="button"
              disabled={!changed}
              onClick={() => update(originalOrientation)}
            >
              <WorkspaceIcon name="reset" />
              复位
            </button>
          </div>
        </fieldset>
        <div className={styles.output} id={outputId}>
          <span>输出尺寸</span>
          <strong>
            {output ? `${output.width} × ${output.height} px` : "等待原图加载"}
          </strong>
          {value.rotate % 90 !== 0 ? (
            <small>旋转产生的空白会保留为透明区域。</small>
          ) : null}
          {invalid ? (
            <p role="alert">
              输出尺寸超出保存范围，请先使用“调整大小”。每边需为 16–8192
              px，总计最多 3200 万像素。
            </p>
          ) : null}
        </div>
      </div>
      <div className={styles.save}>
        <button
          type="button"
          className={workspaceStyles.primary}
          disabled={
            busy || pending || angleInvalid || !changed || !params?.success
          }
          aria-describedby={outputId}
          onClick={() => {
            if (params?.success) onSave(params.data);
          }}
        >
          {busy ? "正在提交…" : "保存为新版本"}
        </button>
        <small>原图保留，不消耗生图额度。</small>
      </div>
    </>
  );
}
