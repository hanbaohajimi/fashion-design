"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { PLUSH_BOUNDS, PLUSH_HIT_PATH, type PlushAsset } from "./plush-assets";
import { createPlushRuntime, type PlushRuntime } from "./plush-runtime";
import type { CharacterPresentation } from "./project-activity";
import styles from "./plush-character.module.css";

function placement(name: PlushAsset): CSSProperties {
  const [x0, y0, x1, y1] = PLUSH_BOUNDS[name];
  return { left: (x0 - 173) / 896 * 100 + "%", top: (y0 - 74) / 1120 * 100 + "%", width: (x1 - x0) / 896 * 100 + "%", height: (y1 - y0) / 1120 * 100 + "%" };
}

function Layer({ name, className, fill }: { name: PlushAsset; className?: string; fill?: boolean }) {
  // The rig needs the original, immediately available image element for its WebGL texture.
  // eslint-disable-next-line @next/next/no-img-element
  return <img data-asset={name} data-fill={fill ? "" : undefined} className={className} style={fill ? undefined : placement(name)} src={`/assistant/zhiya/assets/${name}.webp`} alt="" draggable={false} decoding="async" />;
}
interface Props {
  storageKey: string;
  presentation: CharacterPresentation;
  paused: boolean;
  size: 72 | 96;
  onOpenChat: (focusInput: boolean) => void;
  onActiveChange: (active: boolean) => void;
  onUnavailable?: () => void;
}

export const PlushCharacter = memo(function PlushCharacter(props: Props) {
  const root = useRef<HTMLDivElement>(null);
  const runtime = useRef<PlushRuntime | null>(null);
  const latest = useRef(props);
  const [failed, setFailed] = useState(false);
  const { onUnavailable } = props;
  useEffect(() => { if (failed) onUnavailable?.(); }, [failed, onUnavailable]);
  useLayoutEffect(() => {
    latest.current = props;
    runtime.current?.update(props.presentation, props.paused, props.size);
  }, [props]);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || failed) return;
    try {
      const controller = createPlushRuntime(element, {
        size: latest.current.size,
        paused: latest.current.paused,
        storageKey: props.storageKey,
        onOpenChat: focusInput => latest.current.onOpenChat(focusInput),
        onActiveChange: active => latest.current.onActiveChange(active),
        onInteraction: () => undefined,
      });
      runtime.current = controller;
      controller.update(latest.current.presentation, latest.current.paused, latest.current.size);
      return () => { controller.dispose(); runtime.current = null; };
    } catch {
      queueMicrotask(() => { if (element.isConnected) setFailed(true); });
      return undefined;
    }
  }, [props.storageKey, failed]);
  if (failed) return null;
  return <div ref={root} className={styles.root} data-zhiya data-active="false" hidden={props.paused} onError={() => setFailed(true)}>
    <div className="pp-stage">
      <div className="pp-position">
        <span className="pp-shadow" aria-hidden="true" />
        <span className="pp-contact" aria-hidden="true" />
        <div className="pp-character">
          <span className="pp-rise"><span className="pp-lean"><span className="pp-form"><span className="pp-breathe">
            <span className="pp-rig" aria-hidden="true">
              <span className="pp-crown pp-upper pp-layer"><span className="pp-leaf-big pp-layer">
                <Layer name="sprout" />
                <span className="pp-leaf-small pp-layer"><Layer name="small-leaf" /></span>
              </span></span>
              <Layer name="body" className="pp-body-fallback" />
              <canvas className="pp-body-mesh" aria-hidden="true"></canvas>
              <span className="pp-face-plane pp-upper pp-layer"><span className="pp-face pp-layer">
                <Layer name="brow-left" className="pp-brow pp-brow-left" />
                <Layer name="brow-right" className="pp-brow pp-brow-right" />
                <span className="pp-eyes pp-layer">
                  <span className="pp-eye" style={placement("eye-left")}>
                    <Layer name="eye-left" className="pp-eye-open" fill />
                    <Layer name="eye-left-rest" className="pp-eye-rest" fill />
                    <Layer name="eye-left-happy" className="pp-eye-happy" fill />
                  </span>
                  <span className="pp-eye" style={placement("eye-right")}>
                    <Layer name="eye-right" className="pp-eye-open" fill />
                    <Layer name="eye-right-rest" className="pp-eye-rest" fill />
                    <Layer name="eye-right-happy" className="pp-eye-happy" fill />
                  </span>
                </span>
                <span className="pp-mouth" style={placement("mouth-rest")}>
                  <Layer name="mouth-rest" className="pp-mouth-rest" fill />
                  <Layer name="mouth-oh" className="pp-mouth-oh" fill />
                </span>
              </span></span>
              <span className="pp-prop-plane pp-upper pp-layer"><span className="pp-work-kit pp-layer">
                <Layer name="design-pad" />
                <Layer name="fold-left" />
                <span className="pp-pencil-motion pp-layer">
                  <Layer name="fold-right-back" />
                  <Layer name="cloth-pencil" />
                  <Layer name="fold-right" />
                </span>
              </span></span>
              <span className="pp-curious-marks pp-upper pp-layer">
                <Layer name="thread-dot" className="pp-dot-one" />
                <Layer name="thread-dot" className="pp-dot-two" />
              </span>
              <span className="pp-question-plane pp-upper pp-layer"><Layer name="thread-question" className="pp-question" /></span>
              <span className="pp-thoughts pp-upper pp-layer">
                <span className="pp-thought-mark pp-thought-one"><Layer name="thread-question" fill /></span>
                <span className="pp-thought-mark pp-thought-two"><Layer name="thread-question" fill /></span>
                <span className="pp-thought-mark pp-thought-three"><Layer name="thread-question" fill /></span>
              </span>
              <span className="pp-spark pp-spark-primary" style={placement("thread-spark")}><Layer name="thread-spark" fill /></span>
              <span className="pp-spark pp-spark-secondary"><Layer name="thread-spark" fill /></span>
            </span>
          </span></span></span></span>

          <svg className="pp-hit" data-guide={!props.paused ? "workspace-assistant" : undefined} data-guide-variant="collapsed" viewBox="0 0 896 1120" preserveAspectRatio="none" role="button" tabIndex={props.paused ? -1 : 0} aria-label="织芽，轻点打开设计助手，长按移动" aria-expanded="false" aria-controls="workflow-design-assistant">
            <path d={PLUSH_HIT_PATH} fill="transparent" fillRule="evenodd" />
          </svg>
        </div>
        <div className="pp-label-anchor">
          <button type="button" className="pp-label" hidden aria-label="查看设计助手状态" aria-controls="workflow-design-assistant">
            <span className="pp-speech" hidden />
            <span className="pp-status"><span className="pp-expression" aria-hidden="true" hidden /><span className="pp-caption" /></span>
          </button>
        </div>
      </div>
    </div>
    <span className="pp-announcement" role="status" aria-live="polite" aria-atomic="true" />
  </div>;
});
