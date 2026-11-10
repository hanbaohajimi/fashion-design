"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "../../../components/ui";
import { DesignPathPanel } from "../generation/DesignPathPanel";
import { VersionTimeline } from "../generation/VersionTimeline";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./canvas-object-history.module.css";

export interface CanvasHistoryTarget { assetId: string; nodeId: string | null; title: string }

export function CanvasObjectHistory({ target, onClose, onOpenWorkspace }: {
  target: CanvasHistoryTarget;
  onClose: () => void;
  onOpenWorkspace?: (() => boolean) | undefined;
}) {
  const [path, setPath] = useState(false);
  const [notice, setNotice] = useState("");
  const [comparing, setComparing] = useState(false);
  return createPortal(<Dialog label="对象历史" onClose={onClose} className={`${styles.dialog} ${comparing ? styles.comparing : ""}`}>
    <header className={styles.header}>
      <div><h2>对象历史</h2><p title={target.title}>{target.title}</p></div>
      <button type="button" aria-label="关闭对象历史" onClick={onClose}><WorkspaceIcon name="close" /></button>
    </header>
    <div hidden={comparing} className={styles.views} role="group" aria-label="历史查看方式">
      <button type="button" aria-pressed={!path} onClick={() => setPath(false)}>图片版本</button>
      <button type="button" aria-pressed={path} onClick={() => setPath(true)}>设计路径</button>
    </div>
    <div className={styles.body} data-object-history-scroll>
      <div hidden={path}><VersionTimeline assetId={target.assetId} readOnly onComparisonChange={setComparing} /></div>
      {path ? <div className={styles.path}><DesignPathPanel assetId={target.assetId} readOnly embedded /></div> : null}
    </div>
    <footer hidden={comparing} className={styles.footer}>
      {onOpenWorkspace && target.nodeId ? <button type="button" onClick={() => {
        if (onOpenWorkspace()) onClose();
        else setNotice("这张图片的画布关联已变化，历史仍可查看。请关闭后重新选择图片。");
      }}>在图片工作区恢复版本</button> : <span>仅查看历史</span>}
      {notice ? <p role="status">{notice}</p> : null}
    </footer>
  </Dialog>, document.body);
}
