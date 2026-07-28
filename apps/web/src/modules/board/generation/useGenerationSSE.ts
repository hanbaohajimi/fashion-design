"use client";

import { useEffect, useState } from "react";

import { fetchGenerationTask } from "./generation-api";
import type {
  GenerationStatus,
  GenerationTaskDetail,
} from "./generation-types";

const TERMINAL = new Set<GenerationStatus>([
  "succeeded",
  "failed",
  "moderation_failed",
  "canceled",
]);
const POLL_INTERVAL_MS = 2_000;
const MAX_SSE_ERRORS = 2;

interface GenerationEvent {
  readonly status?: GenerationStatus;
  readonly taskId?: string;
}

export function useGenerationSSE(
  taskId: string,
  onTask: (task: GenerationTaskDetail) => void,
): "sse" | "polling" {
  const [mode, setMode] = useState<"sse" | "polling">("sse");

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let pollTimer: number | undefined;
    let errorCount = 0;

    const stop = (): void => {
      source?.close();
      source = null;
      if (pollTimer) {
        window.clearTimeout(pollTimer);
        pollTimer = undefined;
      }
    };

    const sync = async (): Promise<boolean> => {
      try {
        const task = await fetchGenerationTask(taskId);
        if (disposed) return true;
        onTask(task);
        if (TERMINAL.has(task.status)) {
          stop();
          return true;
        }
      } catch {
        // Keep the active transport alive; the next SSE event or poll retries.
      }
      return false;
    };

    const poll = async (): Promise<void> => {
      if (disposed || (await sync())) return;
      pollTimer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    const fallbackToPolling = (): void => {
      source?.close();
      source = null;
      setMode("polling");
      void poll();
    };

    source = new EventSource(
      `/api/generations/${encodeURIComponent(taskId)}/events`,
      { withCredentials: true },
    );
    source.addEventListener("generation", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as
          GenerationEvent;
        if (payload.taskId !== taskId) return;
        errorCount = 0;
        void sync();
      } catch {
        // Malformed events never replace the server detail response.
      }
    });
    source.onopen = () => {
      errorCount = 0;
    };
    source.onerror = () => {
      errorCount += 1;
      if (errorCount >= MAX_SSE_ERRORS) fallbackToPolling();
    };
    void sync();

    return () => {
      disposed = true;
      stop();
    };
  }, [onTask, taskId]);

  return mode;
}
