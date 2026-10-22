"use client";

import {
  cloneElement,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type ReactElement,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  type Ref,
} from "react";
import styles from "./ui.module.css";
import { UI_TIMING } from "./ui-config";
import { createPortal } from "react-dom";
import { userFacingError } from "./user-facing-error";

export function Button({
  variant = "secondary",
  size = "default",
  loading = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: "primary" | "secondary" | "ghost" | "danger";
  readonly size?: "default" | "small";
  readonly loading?: boolean;
}) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setWaiting(true), UI_TIMING.busyFeedback);
    return () => { clearTimeout(timer); setWaiting(false); };
  }, [loading]);
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={`${styles.button} ${className}`}
      data-size={size}
      data-variant={variant}
      disabled={disabled || loading}
      type={type}
    >
      {children}
      {loading && waiting ? <span aria-hidden="true" className={styles.busyMark}>···</span> : null}
    </button>
  );
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
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${styles.input} ${props.className ?? ""}`} />
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
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {error ? (
        <small role="alert">{error}</small>
      ) : hint ? (
        <small>{hint}</small>
      ) : null}
    </label>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly tone?: "neutral" | "success" | "warning" | "error";
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
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
  readonly tone?: "info" | "error" | "success";
  readonly onClose?: () => void;
}) {
  return (
    <div
      className={styles.notice}
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
    >
      <div>{tone === "error" && typeof children === "string" ? userFacingError(children) : children}</div>
      {onClose ? (
        <IconButton label="关闭提示" onClick={onClose} variant="ghost">
          ×
        </IconButton>
      ) : null}
    </div>
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
export function ImagePreview({ src, alt, onRetry }: {
  readonly src: string | undefined;
  readonly alt: string;
  readonly onRetry?: () => Promise<unknown>;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  return !src || failedSource === src ? <div className={styles.imageFallback}>
    <span aria-label={alt} role="img">图片暂时无法加载</span>
    <Button loading={retrying} size="small" onClick={() => { setRetrying(true); void Promise.resolve().then(() => onRetry?.()).then(() => { setFailedSource(null); setAttempt((current) => current + 1); }).catch(() => undefined).finally(() => setRetrying(false)); }}>重试预览</Button>
  </div> : (
    // Signed private images retain their original URL and aspect ratio.
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} key={`${src}:${attempt}`} onError={() => setFailedSource(src)} src={src} />
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

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { value: T; label: string }[];
  readonly onChange: (value: T) => void;
}) {
  return (
    <div aria-label={label} className={styles.segments} role="group">
      {options.map((option, index) => (
        <button
          aria-pressed={value === option.value}
          key={option.value}
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
export function Tabs<T extends string>({ id, label, value, options, onChange, className = "" }: {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly options: readonly { value: T; label: string; disabled?: boolean }[];
  readonly onChange: (value: T) => void;
  readonly className?: string | undefined;
}) {
  const [focused, setFocused] = useState<T | null>(null);
  return <div aria-label={label} className={`${styles.tabs} ${className}`} role="tablist" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(null); }}>
    {options.map((option) => <button aria-controls={`${id}-panel-${option.value}`} aria-selected={value === option.value} disabled={option.disabled} id={`${id}-tab-${option.value}`} key={option.value} onClick={() => onChange(option.value)} onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const items = options.filter((item) => !item.disabled);
      const index = items.findIndex((item) => item.value === option.value);
      const next = event.key === "Home" ? items[0] : event.key === "End" ? items.at(-1) : items[(index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length];
      if (next) { setFocused(next.value); document.getElementById(`${id}-tab-${next.value}`)?.focus(); }
    }} role="tab" tabIndex={(focused ?? value) === option.value ? 0 : -1} type="button">{option.label}</button>)}
  </div>;
}

export function TabPanel<T extends string>({ tabsId, value, activeValue, children, className = "", keepMounted = false }: {
  readonly tabsId: string;
  readonly value: T;
  readonly activeValue: T;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly keepMounted?: boolean;
}) {
  const active = value === activeValue;
  return <div aria-labelledby={`${tabsId}-tab-${value}`} className={`${styles.tabPanel} ${className}`} hidden={!active} id={`${tabsId}-panel-${value}`} role="tabpanel" tabIndex={0}>{active || keepMounted ? children : null}</div>;
}

export function Tooltip({ children, content }: {
  readonly children: ReactElement<{ "aria-describedby"?: string }>;
  readonly content: string;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!anchor || !tip.current) return;
      const trigger = anchor.getBoundingClientRect();
      const box = tip.current.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(tip.current).getPropertyValue("--space-2")) || 0;
      tip.current.style.left = `${Math.max(gap, Math.min(trigger.left + (trigger.width - box.width) / 2, innerWidth - box.width - gap))}px`;
      tip.current.style.top = `${trigger.top >= box.height + gap ? trigger.top - box.height - gap : trigger.bottom + gap}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor, open]);
  return <span className={styles.tooltipAnchor} ref={setAnchor} onFocus={() => { clearTimer(); setOpen(true); }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { clearTimer(); setOpen(false); } }} onPointerEnter={() => { clearTimer(); timer.current = setTimeout(() => setOpen(true), UI_TIMING.tooltipOpen); }} onPointerLeave={() => { clearTimer(); if (!anchor?.contains(document.activeElement)) timer.current = setTimeout(() => setOpen(false), UI_TIMING.tooltipClose); }} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.stopPropagation(); clearTimer(); setOpen(false); } }}>
    {cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" ") })}
    {anchor ? createPortal(<span className={styles.tooltip} hidden={!open} id={id} ref={tip} role="tooltip">{content}</span>, anchor.closest("dialog[open]") ?? document.body) : null}
  </span>;
}

/** Native disclosure keeps the trigger available without implementing a second focus system. */
export function Menu({
  label,
  children,
  trigger,
  placement = "bottom",
  align = "end",
  className = "",
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly trigger?: ReactNode;
  readonly placement?: "top" | "bottom";
  readonly align?: "start" | "end";
  readonly className?: string | undefined;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node))
        ref.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details
      className={`${styles.menu} ${className}`}
      data-placement={placement}
      data-align={align}
      ref={ref}
      onKeyDown={(event) => {
        const root = event.currentTarget;
        const items = Array.from(
          root.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]"),
        );
        if (event.key === "Escape") {
          event.preventDefault();
          root.open = false;
          root.querySelector("summary")?.focus();
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          root.open = true;
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next =
            index < 0
              ? event.key === "ArrowDown"
                ? 0
                : items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
          items[next]?.focus();
        }
      }}
    >
      <summary aria-label={label}>{trigger ?? label}</summary>
      <div
        onClick={(event) => {
          if ((event.target as Element).closest("button,a"))
            ref.current?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}

/** A view inside an existing dialog: shares the native modal's focus boundary. */
export function DialogView({ children, className = "" }: { readonly children: ReactNode; readonly className?: string | undefined }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => { requestAnimationFrame(() => { if (previous instanceof HTMLElement && previous.isConnected && !previous.closest("[inert],[hidden]")) previous.focus(); }); };
  }, []);
  return <section className={className} ref={ref} tabIndex={-1}>{children}</section>;
}

export function Dialog({
  open = true,
  label,
  children,
  onClose,
  returnFocusSelector,
  busy = false,
  className = "",
}: {
  readonly open?: boolean;
  readonly label: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly returnFocusSelector?: string;
  readonly busy?: boolean;
  readonly className?: string | undefined;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    (
      dialog?.querySelector<HTMLElement>("[autofocus]") ??
      dialog?.querySelector<HTMLElement>("input:not(:disabled),textarea:not(:disabled),select:not(:disabled)") ??
      dialog?.querySelector<HTMLElement>("button:not(:disabled)") ?? dialog
    )?.focus();
    return () => {
      dialog?.close();
      const target = returnFocusSelector
        ? document.querySelector(returnFocusSelector)
        : previous;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [open, returnFocusSelector]);
  return (
    <dialog
      aria-label={label}
      aria-busy={busy || undefined}
      className={`${styles.dialog} ${className}`}
      data-dialog-id={title}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.key !== "Tab") return;
        event.stopPropagation();
        const dialog = event.currentTarget;
        const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),textarea:not(:disabled),select:not(:disabled),summary,[tabindex]:not([tabindex="-1"])')).filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
        const first = items[0];
        const last = items.at(-1);
        if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
        if (!dialog.contains(document.activeElement) || document.activeElement === dialog || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
    >
      {children}
    </dialog>
  );
}
