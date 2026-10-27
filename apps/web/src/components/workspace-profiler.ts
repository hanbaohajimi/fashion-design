import type { ProfilerOnRenderCallback } from "react";

let enabled: boolean | undefined;

/** Explicit local diagnostic switch. No payloads or text leave the browser. */
export const profileWorkspaceCommit: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
  if (process.env.NODE_ENV === "production") return;
  if (enabled === undefined) {
    try { enabled = sessionStorage.getItem("fashion:profile-workspace") === "1"; }
    catch { enabled = false; }
  }
  if (enabled) window.dispatchEvent(new CustomEvent("fashion:workspace-profile", { detail: { id, phase, actualDuration, baseDuration, at: performance.now() } }));
};
