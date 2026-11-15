"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "../../../components/ui";
import { homeShortcut } from "../../projects/workspace-tools";
import styles from "./workflow-canvas.module.css";

interface OpeningRequest {
  id: string;
  flight: Promise<void> | null;
  completed: boolean;
  lastAttempt: number;
}

/** One-time handoff from a homepage shortcut; failures retry inside the created project. */
export function CanvasShortcutEntry({
  accountId,
  projectId,
  canvasReady,
  functionsReady,
  onOpen,
}: {
  accountId: string;
  projectId: string;
  canvasReady: boolean;
  functionsReady: boolean;
  onOpen: (entryId: string, requestId: string) => Promise<void>;
}) {
  const shortcut = homeShortcut(useSearchParams().get("openTool"));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requests = useRef(new Map<string, OpeningRequest>());
  useEffect(() => {
    if (
      !shortcut ||
      !canvasReady ||
      (!functionsReady && !shortcut.canvasEntry.startsWith("project-"))
    )
      return;
    const key = `fashion:canvas-shortcut:${accountId}:${projectId}:${shortcut.value}`;
    let request = requests.current.get(key);
    if (!request) {
      let id: string | null = null;
      try {
        id = sessionStorage.getItem(key);
      } catch {
        /* The in-memory request remains usable. */
      }
      if (
        !id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          id,
        )
      )
        id = crypto.randomUUID();
      request = { id, flight: null, completed: false, lastAttempt: -1 };
      requests.current.set(key, request);
      try {
        sessionStorage.setItem(key, id);
      } catch {
        /* Reload recovery is best effort; same-page retries keep the ID. */
      }
    }
    const current = request;
    if (
      !current.completed &&
      !current.flight &&
      current.lastAttempt === attempt
    )
      return;
    let active = true;
    const consume = () => {
      if (!active || window.location.pathname !== `/${projectId}`) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get("openTool") !== shortcut.value) return;
      url.searchParams.delete("openTool");
      // Let Next update useSearchParams; the workspace history registry keeps its position.
      window.history.replaceState(null, "", url);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* The URL has already consumed the handoff. */
      }
    };
    if (current.completed) consume();
    else {
      if (!current.flight) {
        current.lastAttempt = attempt;
        current.flight = onOpen(shortcut.canvasEntry, current.id);
      }
      void current.flight
        .then(() => {
          current.completed = true;
          consume();
        })
        .catch((cause: unknown) => {
          current.flight = null;
          if (active)
            setError(
              cause instanceof Error ? cause.message : "功能尚未打开，请重试。",
            );
        });
    }
    return () => {
      active = false;
    };
  }, [
    accountId,
    projectId,
    shortcut,
    canvasReady,
    functionsReady,
    onOpen,
    attempt,
  ]);
  if (!shortcut) return null;
  return (
    <div className={styles.shortcutStatus} role={error ? "alert" : "status"}>
      <span>
        {error
          ? `${shortcut.label}未能打开：${error}`
          : `正在打开${shortcut.label}…`}
      </span>
      {error ? (
        <Button
          onClick={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        >
          重试打开功能
        </Button>
      ) : null}
    </div>
  );
}
