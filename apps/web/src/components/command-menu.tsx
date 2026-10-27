"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import {
  AdaptivePopup,
  popupSession,
  type PopupSession,
} from "./interactions/adaptive-popup";
import styles from "./ui.module.css";
import choices from "./choice-controls.module.css";

function flatten(nodes: ReactNode): ReactNode[] {
  return Children.toArray(nodes).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? flatten(child.props.children)
      : [child],
  );
}
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textOf(child.props.children)
        : String(child),
    )
    .join("");
}

/** Commands and navigation only. A choice that changes a draft belongs in ChoiceSelect. */
export function Menu({
  label,
  children,
  trigger,
  align = "end",
  className = "",
  triggerRef,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly trigger?: ReactNode;
  /** Kept for source compatibility; placement is resolved from the visible viewport. */
  readonly placement?: "top" | "bottom";
  readonly align?: "start" | "end";
  readonly className?: string | undefined;
  readonly triggerRef?: Ref<HTMLElement>;
  readonly portal?: boolean;
}) {
  const anchor = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const fromEnd = useRef(false);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<PopupSession | null>(null);
  const [query, setQuery] = useState("");
  useImperativeHandle(triggerRef, () => anchor.current as HTMLElement, []);
  const items = flatten(children);
  const commands = items.filter(
    (item) =>
      isValidElement<{ onClick?: unknown; href?: string }>(item) &&
      (item.type === "button" || item.props.onClick || item.props.href),
  );
  const searchable = commands.length > 10;
  const visible = items.filter(
    (item) =>
      !query.trim() ||
      !commands.includes(item) ||
      textOf(item)
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const close = useCallback(
    (restore = false) => {
      setOpen(false);
      if (restore && !session?.sheet) anchor.current?.focus();
    },
    [session],
  );
  const show = (end = false) => {
    if (!anchor.current) return;
    fromEnd.current = end;
    setQuery("");
    setSession(
      popupSession(
        anchor.current,
        commands.length * 36 + (searchable ? 50 : 0) + 12,
      ),
    );
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    if (searchable) search.current?.focus();
    else {
      const buttons = panel.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href]",
      );
      buttons?.[fromEnd.current ? buttons.length - 1 : 0]?.focus();
    }
  }, [open, searchable]);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Tab" && !session?.sheet) {
      anchor.current?.focus();
      close(false);
      return;
    }
    const direction =
      event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    if (event.target instanceof HTMLInputElement && !direction) return;
    event.preventDefault();
    const buttons = [
      ...(panel.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled),a[href]",
      ) ?? []),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    buttons[
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : index < 0
            ? direction > 0
              ? 0
              : buttons.length - 1
            : (index + direction + buttons.length) % buttons.length
    ]?.focus();
  };
  return (
    <details className={`${styles.menu} ${className}`} open={open}>
      <summary
        role="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        ref={anchor}
        onClick={(event) => {
          event.preventDefault();
          if (open) close(true);
          else show();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show(event.key === "ArrowUp");
          }
          if (event.key === "Escape") {
            event.preventDefault();
            close(true);
          }
        }}
      >
        {trigger ?? label}
      </summary>
      <AdaptivePopup
        open={open}
        session={session}
        anchor={anchor}
        label={label}
        id={`${id}-popup`}
        align={align}
        onClose={close}
      >
        <div className={choices.panelBody} onKeyDown={onKeyDown}>
          {searchable ? (
            <input
              className={choices.search}
              ref={search}
              type="search"
              aria-label={`搜索${label}`}
              placeholder="搜索命令或页面"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          ) : null}
          <div
            className={`${styles.commandItems} ${choices.list}`}
            id={id}
            role="group"
            aria-label={`${label}选项`}
            ref={panel}
            onClick={(event) => {
              const target = (event.target as Element).closest("button,a");
              if (target && !target.matches(":disabled,[aria-disabled='true']"))
                close(true);
            }}
          >
            {visible}
            {query && !visible.some((item) => commands.includes(item)) ? (
              <p role="status">没有匹配的命令或页面</p>
            ) : null}
          </div>
        </div>
      </AdaptivePopup>
    </details>
  );
}
