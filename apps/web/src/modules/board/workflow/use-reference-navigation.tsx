"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor, TLShape } from "tldraw";
import { motionOptions } from "../../../components/ui-config";
import { centerCameraForViewport } from "./canvas-placements";
import { WorkspaceIcon } from "./WorkspaceIcon";
import { Tooltip } from "../../../components/ui";
import styles from "./reference-navigation.module.css";

/** Temporary camera navigation never changes selection, materials, or the edited draft. */
export function useReferenceNavigation(
  editor: Editor,
  scope: string,
  resolve: (id: string, instances?: readonly string[]) => readonly TLShape[],
) {
  const origin = useRef<{
    camera: { x: number; y: number; z: number };
    viewport: { w: number; h: number };
    onReturn?: (() => void) | undefined;
  } | null>(null);
  const [target, setTarget] = useState<{ id: string; scope: string } | null>(
    null,
  );
  if (target && target.scope !== scope) setTarget(null);
  const resolver = useRef(resolve);
  useEffect(() => {
    resolver.current = resolve;
  }, [resolve]);
  const dismiss = useCallback(() => {
    origin.current = null;
    setTarget(null);
  }, []);
  const goBack = useCallback(() => {
    const saved = origin.current;
    if (!saved) return;
    editor.setCamera(
      centerCameraForViewport(
        saved.camera,
        saved.viewport,
        editor.getViewportScreenBounds(),
      ),
      motionOptions(),
    );
    dismiss();
    saved.onReturn?.();
  }, [dismiss, editor]);
  const visit = useCallback(
    (id: string, instances?: readonly string[], onReturn?: () => void) => {
      if (!id) return false;
      const shape = resolver
        .current(id, instances)
        .find((item) => !editor.isShapeHidden(item));
      const bounds = shape && editor.getShapePageBounds(shape);
      if (!bounds) return false;
      if (!origin.current) {
        const camera = editor.getCamera(),
          viewport = editor.getViewportScreenBounds();
        origin.current = {
          camera: { x: camera.x, y: camera.y, z: camera.z },
          viewport: { w: viewport.w, h: viewport.h },
          onReturn,
        };
      }
      editor.zoomToBounds(bounds, {
        targetZoom: 1,
        inset: Math.min(100, editor.getViewportScreenBounds().w * 0.12),
        ...motionOptions(),
      });
      setTarget({ id, scope });
      return true;
    },
    [editor, scope],
  );
  useEffect(() => {
    origin.current = null;
    return () => {
      origin.current = null;
    };
  }, [scope]);
  useEffect(() => {
    if (!target) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector(
          "dialog:modal,[data-adjusting='true'],[data-popup-kind],[data-voice-state='listening'],[data-voice-state='requesting'],[data-voice-state='finishing']",
        )
      )
        return;
      if (
        document.activeElement?.hasAttribute("aria-describedby") &&
        document.querySelector(
          '[role="tooltip"]:not([hidden]):not([aria-hidden="true"])',
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      goBack();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [goBack, target]);
  return {
    visit,
    dismiss,
    hud: target ? (
      <div
        className={styles.hud}
        data-reference-navigation
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <span role="status">已聚焦到引用素材</span>
        <button type="button" onClick={goBack}>
          返回节点
        </button>
        <Tooltip content="关闭定位提示">
          <button type="button" aria-label="关闭引用定位提示" onClick={dismiss}>
            <WorkspaceIcon name="close" />
          </button>
        </Tooltip>
      </div>
    ) : null,
  };
}
