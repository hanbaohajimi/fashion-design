"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { takeMotion } from "./events";
import { useCoutureMotion } from "./use-couture-motion";

/** An inline destination survives the request origin closing or navigating. */
export function MotionReceipt({
  receiptKey,
  children,
}: {
  receiptKey: string;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const play = useCoutureMotion();
  useEffect(() => {
    // Defer consumption so StrictMode's disposable mount cannot swallow the receipt.
    const frame = requestAnimationFrame(() => {
      const receipt = takeMotion(receiptKey);
      if (receipt)
        play(receipt.effect, {
          anchor: anchor.current,
          eventKey: receipt.eventKey,
        });
    });
    return () => cancelAnimationFrame(frame);
  }, [play, receiptKey]);
  return (
    <span ref={anchor} style={{ display: "inline-block" }}>
      {children}
    </span>
  );
}
