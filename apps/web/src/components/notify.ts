"use client";

/**
 * 统一通知入口 — 封装 sonner，对齐设计系统 token。
 *
 * 用法：
 *   import { notify } from "@/components/notify";
 *   notify.success("保存成功");
 *   notify.error("上传失败", { description: "文件超过 10MB" });
 *   notify.promise(saveProject(), { loading: "保存中…", success: "保存成功", error: "保存失败" });
 *
 * 旧 notifyOperation 保留兼容；新代码统一用 notify.*。
 */

import { toast, type ExternalToast } from "sonner";

const DURATIONS = {
  success: 3200,
  info: 4000,
  warning: 5000,
  error: 6000,
  action: 8000,
} as const;

type ToastOptions = Omit<ExternalToast, "duration">;

export const notify = {
  success(title: string, opts?: ToastOptions) {
    return toast.success(title, { duration: DURATIONS.success, ...opts });
  },
  error(title: string, opts?: ToastOptions) {
    return toast.error(title, { duration: DURATIONS.error, ...opts });
  },
  info(title: string, opts?: ToastOptions) {
    return toast.info(title, { duration: DURATIONS.info, ...opts });
  },
  warning(title: string, opts?: ToastOptions) {
    return toast.warning(title, { duration: DURATIONS.warning, ...opts });
  },
  /**
   * 可操作通知（带按钮）：停留 8s，时间更长，确保用户看到操作。
   */
  action(title: string, opts: ToastOptions & { action: NonNullable<ExternalToast["action"]> }) {
    return toast(title, { duration: DURATIONS.action, ...opts });
  },
  promise: toast.promise.bind(toast),
  dismiss: toast.dismiss.bind(toast),
};

/** @deprecated 请用 notify.success(). 保留兼容，不要用于新代码。 */
export { notifyOperation } from "./operation-notice";
