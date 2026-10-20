"use client";
import { Dialog } from "../../../components/ui";
import controls from "../../../components/ui.module.css";
import type { ReactNode } from "react";
export function WorkflowDialog(props: { readonly children: ReactNode; readonly label: string; readonly onClose: () => void; readonly returnFocusSelector?: string }) {
  return <Dialog {...props} className={controls.controlSurface} />;
}
