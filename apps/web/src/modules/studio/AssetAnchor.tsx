"use client";

import { useState } from "react";
import { Notice } from "../../components/ui";
import styles from "./studio.module.css";

export function AssetAnchor({ url, label, x, y, onPoint, disabled = false }: { readonly url: string; readonly label: string; readonly x: number | undefined; readonly y: number | undefined; readonly onPoint: (x: number, y: number) => void; readonly disabled?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Notice tone="error">关联图片暂时无法加载，请重新载入工作室。</Notice>;
  return <div className={styles.stack}><button className={styles.anchor} type="button" aria-label={label} disabled={disabled} onClick={(event) => {
    const box = event.currentTarget.getBoundingClientRect();
    onPoint(event.detail ? Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) : 0.5, event.detail ? Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) : 0.5);
  }}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img alt={label} src={url} onError={() => setFailed(true)} />
    {x !== undefined && y !== undefined ? <span className={styles.anchorMark} style={{ left: x * 100 + "%", top: y * 100 + "%" }} /> : null}
  </button><small className={styles.muted}>点击图片设置锚点，键盘 Enter 可定位到中心。当前：{x === undefined || y === undefined ? "尚未定位" : Math.round(x * 100) + "% / " + Math.round(y * 100) + "%"}</small></div>;
}
