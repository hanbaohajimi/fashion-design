"use client";

import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import { observeMotionCancellation } from "../../components/interactions/motion-policy";
import { ImagePreview } from "../../components/ui";
import type { Fabric } from "./fabric-types";
import styles from "./fabric-flip-card.module.css";

interface FabricFlipCardProps {
  readonly fabric: Fabric;
  readonly label: string;
  readonly flipped?: boolean | undefined;
  readonly onFlipChange?: ((flipped: boolean) => void) | undefined;
  readonly onOpenDetails: () => void;
  readonly onAdd?: ((fabric: Fabric) => void) | undefined;
  readonly adding: boolean;
  readonly addDisabled: boolean;
}

// Adapted from the supplied React Bits FlipCard. Native buttons own clicks and
// keyboard activation; there is no pointer capture, drag, tilt, or image glare.
export function FabricFlipCard({
  fabric,
  label,
  flipped,
  onFlipChange,
  onOpenDetails,
  onAdd,
  adding,
  addDisabled,
}: FabricFlipCardProps) {
  const [innerFlipped, setInnerFlipped] = useState(false);
  const shown = flipped ?? innerFlipped;
  const reduce = useReducedMotion();
  const turn = useMotionValue(shown ? 180 : 0);
  const frontTrigger = useRef<HTMLButtonElement>(null);
  const backTrigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const moved = useRef(false);
  const detailsId = useId();
  const details = fabric.details;
  const specs = [
    {
      label: "成分",
      value: details?.composition?.length
        ? details.composition
            .map(({ fiber, percent }) => `${fiber} ${percent}%`)
            .join(" / ")
        : "未填写",
      wide: true,
    },
    {
      label: "克重",
      value:
        details?.weightGsm != null ? `${details.weightGsm} g/m²` : "未填写",
    },
    {
      label: "门幅",
      value: details?.widthCm != null ? `${details.widthCm} cm` : "未填写",
    },
    { label: "弹性", value: details?.stretch || "未填写" },
    { label: "组织", value: details?.weave || "未填写" },
    { label: "供应商", value: details?.supplier || "未填写", wide: true },
  ];

  useEffect(() => {
    const target = shown ? 180 : 0;
    const animation =
      reduce || document.hidden
        ? null
        : animate(turn, target, {
            type: "spring",
            stiffness: 170,
            damping: 20,
            restDelta: 0.05,
          });
    if (!animation) turn.jump(target);
    const stop = observeMotionCancellation(() => {
      animation?.stop();
      turn.jump(target);
    });
    return () => {
      stop();
      animation?.stop();
    };
  }, [reduce, shown, turn]);

  useLayoutEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    (shown ? backTrigger : frontTrigger).current?.focus({
      preventScroll: true,
    });
  }, [shown]);

  const beginPress = (event: PointerEvent<HTMLElement>): void => {
    if (event.isPrimary === false || event.button !== 0) return;
    moved.current = false;
    press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };

  const movePress = (event: PointerEvent<HTMLElement>): void => {
    const start = press.current;
    if (
      start?.id === event.pointerId &&
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
    ) {
      moved.current = true;
    }
  };

  const flip = (event: MouseEvent<HTMLElement>): void => {
    if (event.detail > 0 && moved.current) return;
    restoreFocus.current = true;
    if (flipped === undefined) setInnerFlipped(!shown);
    onFlipChange?.(!shown);
  };

  const triggerEvents = {
    onClick: flip,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.repeat && (event.key === "Enter" || event.key === " "))
        event.preventDefault();
    },
  };

  return (
    <div
      className={styles.stage}
      data-flipped={shown}
      data-reduced={Boolean(reduce)}
      data-has-add={Boolean(onAdd)}
      data-guide="fabrics-preview"
      onPointerDownCapture={beginPress}
      onPointerMoveCapture={movePress}
      onPointerUpCapture={() => {
        press.current = null;
      }}
      onPointerCancelCapture={() => {
        press.current = null;
        moved.current = true;
      }}
      onClickCapture={(event) => {
        // Mid-turn the painted face can already be inert. Those clicks land
        // on the rotor instead; let them interrupt the spring as well.
        if (event.target instanceof Element && !event.target.closest("button"))
          flip(event);
      }}
    >
      <motion.div className={styles.rotor} style={{ rotateY: turn }}>
        <div
          className={`${styles.face} ${styles.front}`}
          aria-hidden={shown}
          inert={shown}
        >
          <ImagePreview
            alt={label}
            src={fabric.mainImageUrl}
            fit="cover"
            retryable={false}
            draggable={false}
          />
          <button
            {...triggerEvents}
            ref={frontTrigger}
            className={styles.frontTrigger}
            aria-label={`查看面料规格：${label}`}
            aria-pressed={false}
            type="button"
          />
        </div>
        <div
          className={`${styles.face} ${styles.back}`}
          aria-hidden={!shown}
          inert={!shown}
        >
          <button
            {...triggerEvents}
            ref={backTrigger}
            className={styles.backTrigger}
            aria-label={`返回面料图片：${label}`}
            aria-describedby={detailsId}
            aria-pressed
            type="button"
          >
            <span className={styles.heading}>
              <span
                className={styles.name}
                title={details?.name || "未命名面料"}
              >
                {details?.name || "未命名面料"}
              </span>
              {details?.code ? (
                <span className={styles.code} title={details.code}>
                  {details.code}
                </span>
              ) : null}
              <span className={styles.meta}>
                <span className={styles.scope}>
                  {fabric.scope === "preset" ? "系统内置" : "用户上传"}
                </span>
                {details?.category ? (
                  <span className={styles.category} title={details.category}>
                    {details.category}
                  </span>
                ) : null}
              </span>
            </span>
            <span className={styles.specs} id={detailsId}>
              {specs.map((spec) => (
                <span
                  className={styles.spec}
                  data-wide={Boolean(spec.wide)}
                  key={spec.label}
                >
                  <span className={styles.specLabel}>{spec.label}</span>
                  <span
                    className={styles.specValue}
                    data-empty={spec.value === "未填写"}
                  >
                    {spec.value}
                  </span>
                </span>
              ))}
            </span>
          </button>
          <div className={styles.actions}>
            <button
              className={styles.detailsButton}
              onClick={onOpenDetails}
              type="button"
              aria-label={`完整档案：${label}`}
            >
              完整档案
            </button>
            {onAdd ? (
              <button
                className={styles.addButton}
                data-guide={
                  shown && !addDisabled && !adding ? "fabrics-add" : undefined
                }
                disabled={addDisabled || adding}
                aria-busy={adding}
                onClick={() => onAdd(fabric)}
                type="button"
              >
                {adding ? "正在加入…" : "加入当前项目"}
              </button>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
