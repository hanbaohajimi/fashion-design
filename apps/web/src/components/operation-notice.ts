"use client";

import { toast, type ExternalToast } from "sonner";

/** Short confirmed operations only; actionable errors remain beside their owner. */
export function notifyOperation({
  id,
  title,
  description,
  action,
}: {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly action?: ExternalToast["action"];
}) {
  return toast.success(title, {
    id,
    ...(description ? { description } : {}),
    ...(action ? { action } : {}),
    duration: 4000,
  });
}
