"use client";

import {
  Children,
  isValidElement,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type AriaAttributes,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import {
  AdaptivePopup,
  popupSession,
  type PopupSession,
} from "./interactions/adaptive-popup";
import styles from "./choice-controls.module.css";

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly group?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly placeholder?: boolean | undefined;
}

export interface ChoiceSelectProps extends Pick<
  SelectHTMLAttributes<HTMLSelectElement>,
  | "id"
  | "name"
  | "form"
  | "required"
  | "disabled"
  | "autoFocus"
  | "title"
  | "className"
  | "aria-label"
  | "aria-labelledby"
  | "aria-describedby"
  | "aria-invalid"
  | "onInvalid"
> {
  readonly options: readonly ChoiceOption[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly label?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly searchable?: boolean | undefined;
  readonly compact?: boolean | undefined;
  readonly error?: string | undefined;
  readonly onNativeChange?:
    ((event: ChangeEvent<HTMLSelectElement>) => void) | undefined;
}

export interface RadioGroupProps extends AriaAttributes {
  readonly options: readonly ChoiceOption[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean | undefined;
  readonly id?: string | undefined;
}

/** Mutually exclusive values, including draft fields; never submits its enclosing form. */
export function RadioGroup({
  options,
  value,
  onValueChange,
  disabled,
  ...aria
}: RadioGroupProps) {
  const enabled = options.filter(
    (option) => !option.disabled && !option.placeholder,
  );
  const tabValue =
    enabled.find((option) => option.value === value)?.value ??
    enabled[0]?.value;
  return (
    <span
      {...aria}
      className={styles.radios}
      role="radiogroup"
      aria-disabled={disabled || undefined}
    >
      {options
        .filter((option) => !option.placeholder)
        .map((option) => (
          <button
            type="button"
            key={option.value}
            role="radio"
            className={styles.radio}
            aria-label={option.label}
            aria-checked={value === option.value}
            disabled={disabled || option.disabled}
            tabIndex={tabValue === option.value ? 0 : -1}
            onClick={() => {
              if (value !== option.value) onValueChange(option.value);
            }}
            onKeyDown={(event) => {
              const direction =
                event.key === "ArrowRight" || event.key === "ArrowDown"
                  ? 1
                  : event.key === "ArrowLeft" || event.key === "ArrowUp"
                    ? -1
                    : 0;
              if (!direction && event.key !== "Home" && event.key !== "End")
                return;
              event.preventDefault();
              const index = enabled.findIndex(
                (item) => item.value === option.value,
              );
              const next =
                enabled[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? enabled.length - 1
                      : (index + direction + enabled.length) % enabled.length
                ];
              if (!next) return;
              if (next.value !== value) onValueChange(next.value);
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  "button",
                );
              buttons?.[
                options.filter((item) => !item.placeholder).indexOf(next)
              ]?.focus();
            }}
          >
            {option.label}
          </button>
        ))}
    </span>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  describedBy,
}: {
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      className={styles.switch}
      aria-checked={checked}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className={styles.switchTrack} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function ChoiceSelect({
  options,
  value,
  onValueChange,
  label,
  placeholder = "请选择",
  searchable = false,
  compact = false,
  error,
  onNativeChange,
  ...props
}: ChoiceSelectProps) {
  const generated = useId();
  const id = props.id ?? generated;
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const native = useRef<HTMLSelectElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [labelledBy, setLabelledBy] = useState<string | undefined>(
    props["aria-labelledby"],
  );
  const [inferredLabel, setInferredLabel] = useState<string>();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<PopupSession | null>(null);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState<string | undefined>();
  const [invalid, setInvalid] = useState(false);
  const realOptions = options.filter((option) => !option.placeholder);
  const useSearch = searchable || realOptions.length > 10;
  const inline =
    !compact && !searchable && realOptions.length > 0 && realOptions.length < 5;
  const available = !props.disabled && !inline;
  const [wasAvailable, setWasAvailable] = useState(available);
  if (wasAvailable !== available) {
    setWasAvailable(available);
    if (!available && open) setOpen(false);
  }
  const selected = options.find((option) => option.value === value);
  const missing = Boolean(value && !selected && options.length);
  const message =
    error ??
    (invalid
      ? missing
        ? "当前选项已不可用，请重新选择。"
        : "请选择一项后再提交。"
      : undefined);
  const filtered = realOptions.filter((option) =>
    `${option.label} ${option.description ?? ""} ${option.group ?? ""}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const enabled = filtered.filter((option) => !option.disabled);
  const activeValue = enabled.some((option) => option.value === active)
    ? active
    : enabled[0]?.value;
  const description =
    [props["aria-describedby"], message ? `${id}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  const accessibleLabel = props["aria-label"] ?? label ?? inferredLabel;

  useLayoutEffect(() => {
    native.current?.setCustomValidity(
      missing ? "当前选项已不可用，请重新选择。" : "",
    );
  }, [missing]);

  useLayoutEffect(() => {
    if (props["aria-labelledby"] || accessibleLabel) return;
    const field = root.current?.closest("label");
    if (!field) return;
    // Give the existing field label an identity; do not include the selected value in its name.
    const text = [...field.children].find(
      (child) => child !== root.current && child.tagName === "SPAN",
    );
    if (!text) {
      const node = [...field.childNodes].find(
        (child) =>
          child.nodeType === Node.TEXT_NODE && child.textContent?.trim(),
      );
      if (node) setInferredLabel(node.textContent?.trim());
    }
    if (text) {
      if (!text.id) text.id = `${id}-label`;
      setLabelledBy(text.id);
    }
  }, [accessibleLabel, id, props]);

  const close = useCallback(
    (restore = false) => {
      setOpen(false);
      if (restore && !session?.sheet) trigger.current?.focus();
    },
    [session],
  );

  const commit = (next: string) => {
    if (
      props.disabled ||
      native.current?.matches(":disabled") ||
      options.find((option) => option.value === next)?.disabled
    )
      return;
    if (next !== value && native.current) {
      native.current.value = next;
      native.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close(true);
  };
  const show = () => {
    if (!trigger.current || props.disabled || !realOptions.length) return;
    setSession(
      popupSession(
        trigger.current,
        realOptions.length * 36 + (useSearch ? 50 : 0) + 12,
      ),
    );
    setQuery("");
    setComposing(false);
    setActive(selected?.disabled ? undefined : selected?.value);
    setOpen(true);
  };
  useLayoutEffect(() => {
    if (!open) return;
    if (useSearch) searchInput.current?.focus();
    else list.current?.focus();
  }, [open, useSearch]);
  useLayoutEffect(() => {
    if (open)
      document
        .getElementById(
          `${id}-option-${realOptions.findIndex((option) => option.value === activeValue)}`,
        )
        ?.scrollIntoView?.({ block: "nearest" });
  }, [activeValue, id, open, realOptions]);

  const aria = {
    "aria-label": accessibleLabel,
    "aria-labelledby": labelledBy,
    "aria-describedby": description,
    "aria-invalid": message || missing ? true : props["aria-invalid"],
  } as const;
  return (
    <span
      className={`${styles.control} ${props.className ?? ""}`}
      ref={root}
      data-choice-control
    >
      {inline ? (
        <RadioGroup
          {...aria}
          aria-required={props.required || undefined}
          id={id}
          options={realOptions}
          value={value}
          disabled={props.disabled}
          onValueChange={commit}
        />
      ) : (
        <button
          {...aria}
          type="button"
          id={id}
          ref={trigger}
          className={styles.trigger}
          title={props.title}
          disabled={props.disabled || !realOptions.length}
          autoFocus={props.autoFocus}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${id}-list` : undefined}
          onClick={() => (open ? close(true) : show())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              show();
            }
          }}
        >
          <span>
            {selected?.label ?? (value ? "当前选项已不可用" : placeholder)}
          </span>
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
      <select
        ref={native}
        className={styles.formValue}
        aria-hidden="true"
        tabIndex={-1}
        name={props.name}
        form={props.form}
        required={props.required}
        disabled={props.disabled}
        value={value}
        onChange={(event) => {
          setInvalid(false);
          onValueChange(event.currentTarget.value);
          onNativeChange?.(event);
        }}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          (
            trigger.current ??
            root.current?.querySelector<HTMLButtonElement>(
              "button:not(:disabled)",
            )
          )?.focus();
          props.onInvalid?.(event);
        }}
      >
        {!options.some((option) => option.value === "") ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {value && !selected ? (
          <option value={value} disabled>
            当前选项已不可用
          </option>
        ) : null}
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled || option.placeholder}
          >
            {option.label}
          </option>
        ))}
      </select>
      {message ? (
        <small id={`${id}-error`} role="alert" className={styles.error}>
          {message}
        </small>
      ) : null}
      <AdaptivePopup
        open={open && !props.disabled}
        session={session}
        anchor={trigger}
        label={accessibleLabel ?? "选择选项"}
        onClose={close}
        id={`${id}-popup`}
      >
        <div
          className={styles.panelBody}
          onKeyDown={(event) => {
            if (
              composing ||
              event.nativeEvent.isComposing ||
              event.keyCode === 229
            )
              return;
            const direction =
              event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
            if (
              direction ||
              ((!useSearch || event.ctrlKey) &&
                (event.key === "Home" || event.key === "End"))
            ) {
              event.preventDefault();
              const index = enabled.findIndex(
                (option) => option.value === activeValue,
              );
              setActive(
                enabled[
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? enabled.length - 1
                      : (index + direction + enabled.length) % enabled.length
                ]?.value,
              );
            } else if (
              event.key === "Enter" ||
              (!useSearch && event.key === " ")
            ) {
              event.preventDefault();
              if (activeValue !== undefined) commit(activeValue);
            } else if (event.key === "Tab" && !session?.sheet) {
              trigger.current?.focus();
              close(false);
            }
          }}
        >
          {useSearch ? (
            <input
              ref={searchInput}
              className={styles.search}
              role="combobox"
              aria-label={`搜索${accessibleLabel ?? "选项"}`}
              aria-expanded={open}
              aria-controls={`${id}-list`}
              aria-activedescendant={
                activeValue === undefined
                  ? undefined
                  : `${id}-option-${realOptions.findIndex((option) => option.value === activeValue)}`
              }
              aria-autocomplete="list"
              value={query}
              placeholder="搜索已加载的选项"
              onChange={(event) => setQuery(event.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
            />
          ) : null}
          <div
            id={`${id}-list`}
            className={styles.list}
            ref={list}
            role="listbox"
            tabIndex={useSearch ? -1 : 0}
            {...aria}
            aria-required={props.required}
            aria-activedescendant={
              activeValue === undefined
                ? undefined
                : `${id}-option-${realOptions.findIndex((option) => option.value === activeValue)}`
            }
          >
            {filtered.map((option, index) => (
              <span key={option.value}>
                {option.group && option.group !== filtered[index - 1]?.group ? (
                  <span className={styles.group}>{option.group}</span>
                ) : null}
                <span
                  role="option"
                  id={`${id}-option-${realOptions.indexOf(option)}`}
                  className={styles.option}
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  data-active={option.value === activeValue || undefined}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (!option.disabled) commit(option.value);
                  }}
                >
                  <span>{option.label}</span>
                  {option.description ? (
                    <span className={styles.description}>
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </span>
            ))}
            {!filtered.length ? (
              <span className={styles.empty} role="status">
                没有匹配的已加载选项
              </span>
            ) : null}
          </div>
        </div>
      </AdaptivePopup>
    </span>
  );
}

function textContent(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textContent(child.props.children)
        : String(child),
    )
    .join("");
}

/** Compatibility bridge: keep existing form handlers while giving values their own UI. */
export function Select({
  children,
  value,
  defaultValue,
  onChange,
  searchable,
  compact,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  readonly searchable?: boolean;
  readonly compact?: boolean;
}) {
  const [internal, setInternal] = useState(String(defaultValue ?? ""));
  const options: ChoiceOption[] = [];
  const collect = (nodes: ReactNode, group?: string, groupDisabled = false) =>
    Children.forEach(nodes, (child) => {
      if (
        !isValidElement<{
          children?: ReactNode;
          label?: string;
          value?: string | number;
          disabled?: boolean;
        }>(child)
      )
        return;
      if (child.type === "option") {
        const label = textContent(child.props.children);
        options.push({
          value: String(child.props.value ?? label),
          label,
          group,
          disabled: groupDisabled || child.props.disabled,
          placeholder:
            child.props.value === "" &&
            /^(请选择|选择(?!全部)|暂无|.*加载中|.*加载失败)/.test(label),
        });
      } else
        collect(
          child.props.children,
          child.type === "optgroup" ? child.props.label : group,
          groupDisabled || Boolean(child.props.disabled),
        );
    });
  collect(children);
  return (
    <ChoiceSelect
      {...props}
      value={String(value ?? internal)}
      options={options}
      searchable={searchable}
      compact={compact}
      onValueChange={setInternal}
      onNativeChange={onChange}
    />
  );
}
