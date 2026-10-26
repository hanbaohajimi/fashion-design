"use client";

import NumberFlow from "@number-flow/react";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const supported = () => typeof Element.prototype.animate === "function" && typeof window.matchMedia === "function";

/** 只播放已加载的真实计数变化；库默认尊重系统减弱动态偏好。 */
export function StudioCount({ value }: { readonly value: number }) {
  const animated = useSyncExternalStore(subscribe, supported, () => false);
  if (!animated) return <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>;
  return <NumberFlow value={value} transformTiming={{ duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }} spinTiming={{ duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" }} opacityTiming={{ duration: 150, easing: "ease-out" }} style={{ fontVariantNumeric: "tabular-nums" }} />;
}
