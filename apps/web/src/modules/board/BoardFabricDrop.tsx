"use client";

import { useEffect, useState } from "react";
import { useEditor } from "tldraw";

import { addFabricToBoard } from "./fabric-board";
import { decodeFabricDragPayload, FABRIC_DRAG_MIME } from "./fabric-drag";
import styles from "./board.module.css";

export function BoardFabricDrop() {
  const editor = useEditor();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let dragDepth = 0;
    const carriesFabric = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes(FABRIC_DRAG_MIME);
    const onDragEnter = (event: DragEvent): void => {
      if (!carriesFabric(event)) return;
      event.preventDefault();
      dragDepth += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent): void => {
      if (!carriesFabric(event) || !event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent): void => {
      if (!carriesFabric(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent): void => {
      const raw = event.dataTransfer?.getData(FABRIC_DRAG_MIME) ?? "";
      const payload = decodeFabricDragPayload(raw);
      if (!payload) return;
      event.preventDefault();
      dragDepth = 0;
      setDragging(false);
      addFabricToBoard(
        editor,
        payload,
        editor.screenToPage({ x: event.clientX, y: event.clientY }),
      );
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [editor]);

  return dragging ? (
    <div className={styles.fabricDropZone}>
      <strong>DROP / FABRIC</strong>
      <span>松开，将面料引用放入白板</span>
    </div>
  ) : null;
}
