"use client";

import {
  cloneElement,
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type ReactElement,
  type TextareaHTMLAttributes,
  type Ref,
  type SyntheticEvent,
} from "react";
import styles from "./ui.module.css";
import effects from "./interactions/pointer-effects.module.css";
import { useMagnetic, useRipple } from "./interactions/pointer-effects";
import { useSpringPress } from "./interactions/use-spring-press";
import type { SubmitFeedbackSnapshot } from "./interactions/use-submit-feedback";
import { useSlidingIndicator } from "./interactions/use-sliding-indicator";
import { motionEase, motionTime, observeMotionCancellation } from "./interactions/motion-policy";
import { useAnimatedPresence } from "./interactions/use-animated-presence";
import { Menu } from "./command-menu";
export { Menu };
import { afterSurfaceMotion, placeFloatingPanel } from "./interactions/floating-position";
import { UI_TIMING } from "./ui-config";
import { createPortal } from "react-dom";
import { userFacingError } from "./user-facing-error";
import { useTooltipGroup } from "./tooltip-group";
import { Select, ChoiceSelect, RadioGroup, Switch } from "./choice-controls";
export { Select, ChoiceSelect, RadioGroup, Switch };
export type { ChoiceOption, ChoiceSelectProps, RadioGroupProps } from "./choice-controls";
export { TooltipGroup } from "./tooltip-group";

function withDecoration<E extends SyntheticEvent>(
  external: ((event: E) => void) | undefined,
  decorate: (event: E) => void,
  cleanup = false,
) {
  return (event: E) => {
    external?.(event);
    if (cleanup || !event.defaultPrevented) decorate(event);
  };
}

export function Button({
  variant = "secondary",
  size = "default",
  loading = false,
  interaction = "none",
  feedback,
  feedbackAction = "save",
  className = "",
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "secondary" | "ghost" | "danger";
  readonly size?: "default" | "small";
  readonly loading?: boolean;
  readonly interaction?: "none" | "ripple" | "magnetic" | "spring";
  readonly feedback?: SubmitFeedbackSnapshot | undefined;
  readonly feedbackAction?: string | undefined;
  readonly ref?: Ref<HTMLButtonElement>;
}) {
  const [waiting, setWaiting] = useState(false);
  const spring = useSpringPress(interaction === "spring", Boolean(disabled));
  const {
    layerRef,
    onPointerDown: rippleDown,
    onPointerCancel: rippleCancel,
  } = useRipple(interaction === "ripple", Boolean(disabled || loading));
  const { visualRef, ...magnetic } = useMagnetic(
    interaction === "magnetic" && !disabled && !loading,
  );
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setWaiting(true), UI_TIMING.busyFeedback);
    return () => {
      clearTimeout(timer);
      setWaiting(false);
    };
  }, [loading]);
  const feedbackPhase = feedback?.actionKey === feedbackAction ? feedback.phase : "idle";
  const showFeedback = Boolean(feedback && ((loading && waiting && feedbackPhase === "pending") || feedbackPhase === "success"));
  const parts = Children.toArray(children);
  const label = parts.length > 1 ? parts.map((child, index) => isValidElement(child) && child.type === "svg" ? <InlineIcon key={index}>{child}</InlineIcon> : child) : children;
  const content = (
    <>
      {feedback ? <span className={styles.feedbackLabel} data-hidden={showFeedback || undefined}>{label}</span> : label}
      {showFeedback ? (
        <span aria-hidden="true" className={styles.feedbackMark} key={feedback?.revision} data-phase={feedbackPhase}>
          {feedbackPhase === "success" ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path className={styles.feedbackCheck} d="m5 12 4 4L19 6" pathLength="1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg> : <i className={styles.feedbackSpinner} />}
        </span>
      ) : null}
      {!feedback && loading && waiting ? (
        <span aria-hidden="true" className={styles.busyMark}>
          ··
        </span>
      ) : null}
    </>
  );
  return (
    <button
      {...props}
      {...(interaction === "ripple"
        ? {
            onPointerDown: withDecoration(props.onPointerDown, rippleDown),
            onPointerCancel: withDecoration(
              props.onPointerCancel,
              rippleCancel,
              true,
            ),
          }
        : interaction === "magnetic"
          ? {
              onPointerEnter: withDecoration(
                props.onPointerEnter,
                magnetic.onPointerEnter,
              ),
              onPointerMove: withDecoration(
                props.onPointerMove,
                magnetic.onPointerMove,
              ),
              onPointerDown: withDecoration(
                props.onPointerDown,
                magnetic.onPointerDown,
              ),
              onPointerUp: withDecoration(
                props.onPointerUp,
                magnetic.onPointerUp,
              ),
              onPointerLeave: withDecoration(
                props.onPointerLeave,
                magnetic.onPointerLeave,
                true,
              ),
              onPointerCancel: withDecoration(
                props.onPointerCancel,
                magnetic.onPointerCancel,
                true,
              ),
              onBlur: withDecoration(props.onBlur, magnetic.onBlur, true),
              onFocus: withDecoration(props.onFocus, magnetic.onFocus, true),
            }
          : interaction === "spring" ? {
              onPointerDown: withDecoration(props.onPointerDown, spring.press),
              onPointerUp: withDecoration(props.onPointerUp, spring.release),
              onPointerCancel: withDecoration(props.onPointerCancel, spring.reset, true),
              onPointerLeave: withDecoration(props.onPointerLeave, spring.reset, true),
              onBlur: withDecoration(props.onBlur, spring.reset, true),
              onKeyDown: withDecoration(props.onKeyDown, (event) => { if (!event.repeat && [" ", "Enter"].includes(event.key)) spring.press(); }),
              onKeyUp: withDecoration(props.onKeyUp, (event) => { if ([" ", "Enter"].includes(event.key)) spring.release(); }),
            } : {})}
      aria-busy={loading || undefined}
      className={`${styles.button} ${className}`}
      data-size={size}
      data-variant={variant}
      data-interaction={interaction === "none" ? undefined : interaction}
      data-feedback={feedback ? feedbackPhase : undefined}
      disabled={disabled || loading}
      type={type}
    >
      {interaction === "magnetic" || interaction === "spring" ? (
        <span
          ref={interaction === "spring" ? spring.visualRef : visualRef}
          className={`${styles.button} ${effects.magneticVisual}`}
          data-size={size}
          data-variant={variant}
        >
          {content}
        </span>
      ) : (
        content
      )}
      {interaction === "ripple" ? (
        <span
          ref={layerRef}
          aria-hidden="true"
          className={effects.rippleLayer}
        />
      ) : null}
    </button>
  );
}

export function InlineIcon({ children }: { readonly children: ReactNode }) {
  return <span className={styles.inlineIcon} aria-hidden="true">{children}</span>;
}

export function IconButton({
  label,
  ...props
}: Omit<Parameters<typeof Button>[0], "aria-label"> & {
  readonly label: string;
}) {
  return (
    <Button
      {...props}
      aria-label={label}
      title={label}
      className={`${styles.iconButton} ${props.className ?? ""}`}
    />
  );
}

export function Input(
  props: InputHTMLAttributes<HTMLInputElement> & {
    readonly ref?: Ref<HTMLInputElement>;
  },
) {
  return (
    <input {...props} className={`${styles.input} ${props.className ?? ""}`} />
  );
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${styles.input} ${props.className ?? ""}`}
    />
  );
}
export function Field({
  label,
  children,
  hint,
  error,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string;
  readonly error?: string;
}) {
  const descriptionId = useId();
  const described = Boolean(error || hint);
  let labelledControlId: string | undefined;
  const controls = Children.map(children, (child, index) => {
    if (
      !isValidElement<InputHTMLAttributes<HTMLInputElement>>(child) ||
      !(["input", "select", "textarea", Input, Select, ChoiceSelect, RadioGroup, Textarea].includes(
        child.type as typeof Input,
      ) || (typeof child.type !== "string" && "value" in child.props))
    )
      return child;
    const controlId = child.props.id ?? `${descriptionId}-control-${index}`;
    labelledControlId ??= controlId;
    return cloneElement(child, {
      id: controlId,
      "aria-label": child.props["aria-label"] ?? (typeof label === "string" ? label : undefined),
      "aria-describedby":
        [child.props["aria-describedby"], described ? descriptionId : undefined]
          .filter(Boolean)
          .join(" ") || undefined,
      "aria-invalid": error ? true : child.props["aria-invalid"],
    });
  });
  return (
    <div className={styles.field}>
      <label htmlFor={labelledControlId} onClick={() => {
        const control = labelledControlId ? document.getElementById(labelledControlId) : null;
        if (control?.matches('[role="radiogroup"],[data-asset-select]'))
          (control.querySelector<HTMLButtonElement>('button[aria-checked="true"]:not(:disabled)') ?? control.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
      }}>{label}</label>
      {controls}
      {error ? (
        <small id={descriptionId} role="alert">
          {error}
        </small>
      ) : hint ? (
        <small id={descriptionId}>{hint}</small>
      ) : null}
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?:
    "neutral" | "success" | "warning" | "error" | "info" | "running";
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {tone !== "neutral" ? <StatusIcon tone={tone} /> : null}
      {children}
    </span>
  );
}
export function Notice({
  children,
  tone = "info",
  onClose,
}: {
  readonly children: ReactNode;
  readonly tone?: "info" | "error" | "success" | "warning" | "running";
  readonly onClose?: () => void;
}) {
  return (
    <div
      className={styles.notice}
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
    >
      <StatusIcon tone={tone} />
      <div>
        {tone === "error" && typeof children === "string"
          ? userFacingError(children)
          : children}
      </div>
      {onClose ? (
        <IconButton label="关闭提示" onClick={onClose} variant="ghost">
          ×
        </IconButton>
      ) : null}
    </div>
  );
}

/** §5.7：语义状态同时提供轮廓、图形和文字，不依赖色相。 */
export function StatusIcon({ tone }: { readonly tone: string }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.statusIcon}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      {tone === "warning" ? (
        <path d="m10 2 8 15H2Z" />
      ) : (
        <circle cx="10" cy="10" r="7.5" />
      )}
      {tone === "success" ? (
        <path d="m6 10 3 3 5-6" />
      ) : tone === "error" ? (
        <path d="m7 7 6 6m0-6-6 6" />
      ) : tone === "running" ? (
        <path d="M10 5v5l3 2" />
      ) : (
        <path d="M10 8v5m0-8v1" />
      )}
    </svg>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <section className={styles.empty}>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </section>
  );
}
export function UploadInput({
  label = "选择图片",
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly label?: string;
  readonly hint?: string;
}) {
  const [fileName, setFileName] = useState("");
  return (
    <span className={styles.uploadField}>
      <label className={styles.uploadTrigger}>
        <input
          {...props}
          type="file"
          onChange={(event) => {
            setFileName(event.currentTarget.files?.[0]?.name ?? "");
            props.onChange?.(event);
          }}
        />
        <span aria-hidden="true">＋</span>
        <span>{label}</span>
      </label>
      {fileName ? (
        <span className={styles.uploadFile} role="status">
          {fileName}
        </span>
      ) : hint ? (
        <span className={styles.uploadHint}>{hint}</span>
      ) : null}
    </span>
  );
}

export function ImagePreview({
  src,
  alt,
  onRetry,
  fit = "contain",
  retryable = true,
  draggable,
}: {
  readonly src: string | undefined;
  readonly alt: string;
  readonly onRetry?: () => Promise<unknown>;
  readonly fit?: "contain" | "cover";
  readonly retryable?: boolean;
  readonly draggable?: boolean;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const explicitRetry = useRef<string | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const cached = useRef(false);
  const reveal = useRef<Animation | null>(null);
  useEffect(() => {
    const cancel = () => reveal.current?.cancel();
    const stop = observeMotionCancellation(cancel);
    return () => { cancel(); stop(); };
  }, []);
  return !src || failedSource === src ? (
    <div className={styles.imageFallback}>
      <span aria-label={alt} role="img">
        {src ? "图片暂时无法加载" : "尚未选择图片"}
      </span>
      {src && retryable ? (
        <Button
          loading={retrying}
          size="small"
          onClick={() => {
            setRetrying(true);
            void Promise.resolve()
              .then(() => onRetry?.())
              .then(() => {
                explicitRetry.current = src;
                setFailedSource(null);
                setAttempt((current) => current + 1);
              })
              .catch(() => undefined)
              .finally(() => setRetrying(false));
          }}
        >
          重试预览
        </Button>
      ) : null}
    </div>
  ) : (
    // Signed private images retain their original URL and aspect ratio.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={(element) => {
        image.current = element;
        if (!element) return;
        cached.current = element.complete && element.naturalWidth > 0;
        if (cached.current) element.style.removeProperty("opacity");
        else element.style.opacity = "0";
      }}
      alt={alt}
      loading="lazy"
      draggable={draggable}
      key={`${src}:${attempt}`}
      onError={() => { reveal.current?.cancel(); setFailedSource(src); }}
      onLoad={(event) => {
        const element = event.currentTarget;
        const fromCache = cached.current && explicitRetry.current !== src;
        explicitRetry.current = null;
        const show = () => {
          if (image.current !== element || !element.isConnected) return;
          reveal.current?.cancel();
          element.style.removeProperty("opacity");
          const opacity = getComputedStyle(element).opacity || "1";
          const duration = motionTime("--motion-image-reveal", 300);
          if (!fromCache && duration && !document.hidden) reveal.current = element.animate?.(
            [{ opacity: 0 }, { opacity }], { duration, easing: motionEase() },
          ) ?? null;
        };
        if (element.decode) void element.decode().then(show, show);
        else show();
      }}
      src={src}
      style={{ objectFit: fit }}
    />
  );
}

export function Skeleton({
  label = "正在加载",
  className = "",
}: {
  readonly label?: string;
  readonly className?: string | undefined;
}) {
  return (
    <div
      aria-label={label}
      aria-busy="true"
      className={`${styles.skeleton} ${className}`}
    />
  );
}

/** One moving highlight per loading region; placeholders retain real geometry. */
export function SkeletonGroup({ children, className = "", active = true }: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly active?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sweeping, setSweeping] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setSweeping(true), 300);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)));
    if (ref.current) observer?.observe(ref.current);
    const update = () => { if (document.hidden) setVisible(false); else if (ref.current) setVisible(ref.current.getBoundingClientRect().bottom > 0); };
    if (!observer) update();
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); observer?.disconnect(); document.removeEventListener("visibilitychange", update); setSweeping(false); };
  }, [active]);
  return <div ref={ref} className={`${styles.skeletonGroup} ${className}`} data-sweeping={active && sweeping && visible || undefined} aria-busy={active || undefined}>{children}<span aria-hidden="true" className={styles.skeletonSweep} /></div>;
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  animated = false,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
  readonly animated?: boolean;
}) {
  const indicator = useSlidingIndicator(value, animated);
  return (
    <div ref={indicator} aria-label={label} className={styles.segments} role="group" data-animated={animated || undefined}>
      {options.map((option, index) => (
        <button
          aria-pressed={value === option.value}
          key={option.value}
          data-indicator-value={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            const direction =
              event.key === "ArrowRight"
                ? 1
                : event.key === "ArrowLeft"
                  ? -1
                  : 0;
            if (!direction) return;
            event.preventDefault();
            const next = (index + direction + options.length) % options.length;
            const option = options[next];
            if (option) onChange(option.value);
            event.currentTarget.parentElement
              ?.querySelectorAll("button")
              [next]?.focus();
          }}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Manual activation avoids starting expensive panels while navigating their labels. */
export function Tabs<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  className = "",
  animated = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly options: readonly { value: T; label: string; disabled?: boolean }[];
  readonly onChange: (value: T) => void;
  readonly className?: string | undefined;
  readonly animated?: boolean;
}) {
  const [focused, setFocused] = useState<T | null>(null);
  const indicator = useSlidingIndicator(value, animated);
  return (
    <div
      aria-label={label}
      className={`${styles.tabs} ${className}`}
      ref={indicator}
      data-animated={animated || undefined}
      role="tablist"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(null);
      }}
    >
      {options.map((option) => (
        <button
          aria-controls={`${id}-panel-${option.value}`}
          aria-selected={value === option.value}
          disabled={option.disabled}
          id={`${id}-tab-${option.value}`}
          key={option.value}
          data-indicator-value={option.value}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            event.stopPropagation();
            const items = options.filter((item) => !item.disabled);
            const index = items.findIndex(
              (item) => item.value === option.value,
            );
            const next =
              event.key === "Home"
                ? items[0]
                : event.key === "End"
                  ? items.at(-1)
                  : items[
                      (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        items.length) %
                        items.length
                    ];
            if (next) {
              setFocused(next.value);
              document.getElementById(`${id}-tab-${next.value}`)?.focus();
            }
          }}
          role="tab"
          tabIndex={(focused ?? value) === option.value ? 0 : -1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel<T extends string>({
  tabsId,
  value,
  activeValue,
  children,
  className = "",
  keepMounted = false,
}: {
  readonly tabsId: string;
  readonly value: T;
  readonly activeValue: T;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly keepMounted?: boolean;
}) {
  const active = value === activeValue;
  return (
    <div
      aria-labelledby={`${tabsId}-tab-${value}`}
      className={`${styles.tabPanel} ${className}`}
      hidden={!active}
      id={`${tabsId}-panel-${value}`}
      role="tabpanel"
      tabIndex={0}
    >
      {active || keepMounted ? children : null}
    </div>
  );
}

export function Tooltip({
  children,
  content,
}: {
  readonly children: ReactElement<{ "aria-describedby"?: string }>;
  readonly content: string;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const tip = useRef<HTMLSpanElement>(null);
  const presence = useAnimatedPresence<HTMLSpanElement>(open, tip, {
    enter: { opacity: 0, transform: "translateY(2px)" },
    enterToken: "--motion-tooltip-enter", exitToken: "--motion-tooltip-exit", enterMs: 150, exitMs: 120,
  });
  const group = useTooltipGroup();
  const shown = useRef(false);
  const touchFocus = useRef(false);
  const dismissed = useRef(false);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = () => {
    clearTimer();
    if (shown.current) group?.close(id);
    shown.current = false;
    setOpen(false);
  };
  const show = () => {
    clearTimer();
    if (dismissed.current) return;
    group?.open(id, close);
    shown.current = true;
    setOpen(true);
  };
  const leave = () => {
    clearTimer();
    if (!anchor?.contains(document.activeElement))
      timer.current = setTimeout(close, UI_TIMING.tooltipClose);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      group?.close(id);
    },
    [group, id],
  );
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!anchor || !tip.current) return;
      const trigger = anchor.getBoundingClientRect();
      const box = tip.current.getBoundingClientRect();
      const gap =
        parseFloat(
          getComputedStyle(tip.current).getPropertyValue("--space-2"),
        ) || 0;
      placeFloatingPanel(tip.current,
        Math.max(gap, Math.min(trigger.left + (trigger.width - box.width) / 2, innerWidth - box.width - gap)),
        trigger.top >= box.height + gap ? trigger.top - box.height - gap : trigger.bottom + gap);
    };
    place();
    const stopSurface = afterSurfaceMotion(tip.current, place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      stopSurface();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, open, tip, presence.present]);
  return (
    <span
      className={styles.tooltipAnchor}
      ref={setAnchor}
      onPointerDown={(event) => {
        touchFocus.current = event.pointerType === "touch";
        if (touchFocus.current) close();
      }}
      onFocus={() => {
        if (!touchFocus.current) show();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          close();
          dismissed.current = false;
          touchFocus.current = false;
        }
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        touchFocus.current = false;
        dismissed.current = false;
        clearTimer();
        const warm = group?.warm();
        if (warm) show();
        else timer.current = setTimeout(show, UI_TIMING.tooltipOpen);
      }}
      onPointerLeave={leave}
      onKeyDown={(event) => {
        touchFocus.current = false;
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          dismissed.current = true;
          close();
        }
      }}
    >
      {cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], id]
          .filter(Boolean)
          .join(" "),
      })}
      {anchor
        ? createPortal(
            <span
              className={styles.tooltip}
              hidden={!presence.present}
              aria-hidden={!open || undefined}
              id={id}
              ref={tip}
              role="tooltip"
              onPointerEnter={clearTimer}
              onPointerLeave={leave}
            >
              {content}
            </span>,
            anchor.closest("dialog[open]") ?? document.body,
          )
        : null}
    </span>
  );
}

/** A view inside an existing dialog: shares the native modal's focus boundary. */
export function DialogView({
  children,
  className = "",
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => {
      requestAnimationFrame(() => {
        if (
          previous instanceof HTMLElement &&
          previous.isConnected &&
          !previous.closest("[inert],[hidden]")
        )
          previous.focus();
      });
    };
  }, []);
  return (
    <section className={className} ref={ref} tabIndex={-1}>
      {children}
    </section>
  );
}

export { MotionDialog as Dialog } from "./interactions/motion-dialog";
