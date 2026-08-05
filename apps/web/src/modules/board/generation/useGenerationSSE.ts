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
const MAX_SSE_ERRORS = 3;
const SSE_RECONNECT_MS = 2_500;

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
    let reconnectTimer: number | undefined;
    let errorCount = 0;
    let polling = false;
    let appliedSyncSequence = 0;
    let syncSequence = 0;

    const stop = (): void => {
      polling = false;
      source?.close();
      source = null;
      if (pollTimer) {
        window.clearTimeout(pollTimer);
        pollTimer = undefined;
      }
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const sync = async (): Promise<boolean> => {
      const sequence = ++syncSequence;
      try {
        const task = await fetchGenerationTask(taskId);
        if (disposed) return true;
        if (sequence < appliedSyncSequence) return false;
        appliedSyncSequence = sequence;
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
      if (disposed || !polling || (await sync())) return;
      pollTimer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    const scheduleReconnect = (): void => {
      if (disposed || !polling || reconnectTimer) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        if (!disposed && polling) openSse();
      }, SSE_RECONNECT_MS);
    };

    const fallbackToPolling = (): void => {
      if (disposed) return;
      source?.close();
      source = null;
      if (!polling) {
        polling = true;
        setMode("polling");
        void poll();
      }
      scheduleReconnect();
    };

    function openSse(): void {
      if (disposed) return;
      source?.close();
      const candidate = new EventSource(
        `/api/generations/${encodeURIComponent(taskId)}/events`,
        { withCredentials: true },
      );
      source = candidate;
      candidate.addEventListener("generation", (event) => {
        try {
          const payload = JSON.parse(
            (event as MessageEvent<string>).data,
          ) as GenerationEvent;
          if (payload.taskId !== taskId) return;
          errorCount = 0;
          void sync();
        } catch {
          // Malformed events never replace the server detail response.
        }
      });
      candidate.onopen = () => {
        if (disposed || source !== candidate) return;
        errorCount = 0;
        polling = false;
        if (pollTimer) {
          window.clearTimeout(pollTimer);
          pollTimer = undefined;
        }
        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
          reconnectTimer = undefined;
        }
        setMode("sse");
        void sync();
      };
      candidate.onerror = () => {
        if (disposed || source !== candidate) return;
        errorCount += 1;
        // EventSource already retries transient disconnects. Only switch the
        // visible transport after repeated failures, while polling keeps the
        // task state current and a short timer attempts to restore SSE.
        if (polling || errorCount >= MAX_SSE_ERRORS) fallbackToPolling();
      };
    }

    openSse();
    void sync();

    return () => {
      disposed = true;
      stop();
    };
  }, [onTask, taskId]);

  return mode;
}
