"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Normal success is silent; short autosaves never flash a status in the artwork. */
interface Props { label: string; className?: string | undefined; children?: ReactNode }
function DelayedSaveStatus(props: Props) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(timer);
  }, []);
  return visible ? <div className={props.className} role="status" aria-label="画布保存状态">{props.label}{props.children}</div> : null;
}
export function CanvasSaveStatus({ label, className, children }: Props) {
  const pending = /保存中|保存…|等待保存|尚未保存/.test(label);
  const actionable = /未完成|冲突|失败|^画布未保存$|同步异常/.test(label);
  if (!actionable && label !== "只读") return pending ? <DelayedSaveStatus label={label} className={className}>{children}</DelayedSaveStatus> : null;
  return <div className={className} data-actionable={actionable} role="status" aria-label="画布保存状态">{label}{children}</div>;
}
