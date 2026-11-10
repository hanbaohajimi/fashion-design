"use client";

import { useRef } from "react";
import {
  attachmentIsWorking,
  type AssistantImageUploadQueue,
  type AssistantImageUploadItem,
} from "./assistant-image-uploads";
import styles from "./assistant-image-uploads.module.css";

const labels: Record<AssistantImageUploadItem["stage"], string> = {
  queued: "等待上传",
  signing: "准备上传",
  uploading: "正在上传",
  processing: "图片处理中",
  importing: "正在加入项目",
  referencing: "正在加入引用",
  failed: "图片准备未完成",
  canceled: "已暂停",
  needs_file: "请选择原图片继续",
  waiting: "上次准备尚未确认",
};
export function AssistantImageUploadTray({
  items,
  error,
  queue,
  disabled,
  ready,
}: {
  items: readonly AssistantImageUploadItem[];
  error: string | null;
  queue: AssistantImageUploadQueue;
  disabled: boolean;
  ready: boolean;
}) {
  const reselect = useRef<HTMLInputElement>(null),
    selected = useRef<string | null>(null);
  if (!items.length && !error) return null;
  return (
    <div className={styles.tray} aria-label="待加入的参考图片">
      {error ? (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          {!ready ? (
            <button type="button" onClick={() => void queue.reload()}>
              重新读取图片记录
            </button>
          ) : (
            <button
              type="button"
              aria-label="关闭图片添加提示"
              onClick={queue.clearError}
            >
              关闭
            </button>
          )}
        </div>
      ) : null}
      <input
        ref={reselect}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        aria-label="重新选择原参考图片"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0],
            id = selected.current;
          event.currentTarget.value = "";
          if (file && id) void queue.reselect(id, file).catch(() => {});
        }}
      />
      {items.length ? (
        <ul className={styles.list} data-image-upload-list>
          {items.map((item) => {
            const busy = attachmentIsWorking(item),
              committed =
                item.stage === "importing" || item.stage === "referencing";
            return (
              <li
                key={item.id}
                className={styles.item}
                data-upload-id={item.id}
                data-stage={item.stage}
              >
                <div className={styles.preview} aria-hidden="true">
                  {item.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      loading="lazy"
                      decoding="async"
                      src={item.preview}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                    />
                  ) : (
                    <span>图片</span>
                  )}
                </div>
                <div className={styles.info}>
                  <strong title={item.name}>{item.name}</strong>
                  <span role={item.error ? "alert" : "status"}>
                    {item.error ?? labels[item.stage]}
                  </span>
                  {item.stage === "uploading" ? (
                    <progress
                      aria-label={`${item.name} 上传进度`}
                      max={1}
                      {...(item.progress === undefined
                        ? {}
                        : { value: item.progress })}
                    />
                  ) : null}
                </div>
                <div className={styles.actions}>
                  {busy ? (
                    !committed ? (
                      <button
                        type="button"
                        aria-label={`暂停上传 ${item.name}`}
                        onClick={() => queue.cancel(item.id)}
                      >
                        暂停
                      </button>
                    ) : null
                  ) : (
                    <>
                      {item.stage === "needs_file" ? (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            selected.current = item.id;
                            reselect.current?.click();
                          }}
                        >
                          重新选择
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => queue.retry(item.id)}
                        >
                          继续添加
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`移除待添加图片 ${item.name}`}
                        onClick={() => void queue.remove(item.id)}
                      >
                        移除
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
