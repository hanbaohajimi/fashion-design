"use client";

import { useEffect } from "react";

/** CSS waiting indicators pause with the document; no animation loop is needed. */
export function MotionEnvironment() {
  useEffect(() => {
    const update = () => { document.documentElement.dataset.motionVisibility = document.hidden ? "hidden" : "visible"; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); delete document.documentElement.dataset.motionVisibility; };
  }, []);
  return null;
}
