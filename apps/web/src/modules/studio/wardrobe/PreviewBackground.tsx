"use client";

import type { CSSProperties } from "react";
import { SegmentedControl } from "../../../components/ui";
import styles from "./preview-background.module.css";

export type PreviewBackground = "white" | "scene" | "dark";

// Fixed inspection surfaces reveal alpha and baked-in white; garment pixels are untouched.
const backgrounds: Record<PreviewBackground, string> = { white: "#ffffff", scene: "#e4e3e5", dark: "#303030" };

export function previewBackgroundStyle(background: PreviewBackground): CSSProperties {
  return { backgroundColor: backgrounds[background] };
}

export function PreviewBackgroundControl({ value, onChange }: { value: PreviewBackground; onChange: (value: PreviewBackground) => void }) {
  return <div className={styles.control}>
    <div className={styles.options}><span>预览底色</span><SegmentedControl label="预览底色" value={value} options={[{ value: "white", label: "白" }, { value: "scene", label: "场景灰" }, { value: "dark", label: "深灰" }]} onChange={onChange} /></div>
    <p>仅改变预览背景；请在三种底色下核对透明材质和白边。</p>
  </div>;
}
