"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { AssistantComposer } from "../../../components/AssistantComposer";
import {
  afterSurfaceMotion,
  placeFloatingPanel,
} from "../../../components/interactions/floating-position";
import { findDraftMention, insertDraftMention } from "./discussion-references";
import styles from "./assistant-mention-input.module.css";

type ReferenceChoice = {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
};
type SkillChoice = {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
};
type Props = Omit<
  ComponentProps<typeof AssistantComposer>,
  "value" | "onChange"
> & {
  value: string;
  contextKey: string;
  nodes: readonly ReferenceChoice[];
  referencedIds: readonly string[];
  onValueChange: (value: string) => void;
  onAddReference: (id: string) => boolean;
  /** 技能列表，敲 / 触发浮层，选取后替换输入框内容 */
  skillChoices?: readonly SkillChoice[];
  onApplySkill?: (skill: SkillChoice) => void;
};

export function AssistantMentionInput({
  value,
  contextKey,
  nodes,
  referencedIds,
  onValueChange,
  onAddReference,
  skillChoices = [],
  onApplySkill,
  ref,
  ...props
}: Props) {
  const input = useRef<HTMLTextAreaElement | null>(null);
  const popup = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const pendingCaret = useRef<{ value: string; caret: number } | null>(null);
  const [container, setContainer] = useState<Element | null>(null);
  const [selection, setSelection] = useState({ value: "", start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const [chosen, setChosen] = useState({ key: "", id: "" });
  const [lengthError, setLengthError] = useState("");
  const selectionKey = (text: string, start: number, end = start) =>
    JSON.stringify([contextKey, text, start, end]);
  const key = selectionKey(value, selection.start, selection.end);
  const mention =
    focused &&
    !composing &&
    !props.disabled &&
    selection.value === value &&
    dismissed !== key
      ? findDraftMention(value, selection.start, selection.end, nodes)
      : null;
  const open = mention !== null;

  // 斜杠命令：光标前紧接 / 触发技能选择浮层
  const slashQuery = (() => {
    if (!focused || composing || props.disabled || selection.value !== value || !skillChoices.length) return null;
    const before = value.slice(0, selection.start);
    const m = /(^|[\s\n])\/([\w一-龥]*)$/.exec(before);
    return m ? { query: (m[2] ?? "").toLowerCase(), slashPos: before.length - 1 - (m[2]?.length ?? 0) } : null;
  })();
  const slashOpen = slashQuery !== null && dismissed !== key;
  const [slashChosen, setSlashChosen] = useState({ key: "", id: "" });
  const slashChoices = slashQuery
    ? skillChoices.filter((s) => !slashQuery.query || s.name.toLowerCase().includes(slashQuery.query)).slice(0, 6)
    : [];
  const slashActiveIndex = slashChosen.key === key ? Math.max(0, slashChoices.findIndex((s) => s.id === slashChosen.id)) : 0;
  const activeSkill = slashChoices[slashActiveIndex];

  function chooseSkill(skill: SkillChoice) {
    if (!slashQuery) return;
    const before = value.slice(0, slashQuery.slashPos);
    const after = value.slice(selection.start);
    const cleaned = (before + after).trimStart();
    setDismissed(key);
    onValueChange(cleaned);
    requestAnimationFrame(() => {
      onApplySkill?.(skill);
      input.current?.focus({ preventScroll: true });
    });
  }
  const choices = mention
    ? nodes
        .filter(
          (node) =>
            node.title &&
            !referencedIds.includes(node.id) &&
            node.title
              .toLocaleLowerCase()
              .includes(mention.query.toLocaleLowerCase()),
        )
        .slice(0, 6)
    : [];
  const activeIndex =
    chosen.key === key
      ? Math.max(
          0,
          choices.findIndex((node) => node.id === chosen.id),
        )
      : 0;
  const active = choices[activeIndex];
  const listId = `${props.id}-references`;
  const hintId = `${listId}-hint`;
  const optionId = (index: number) => `${listId}-${index}`;

  function rememberSelection(element: HTMLTextAreaElement) {
    setContainer(element.closest("dialog[open]") ?? document.body);
    setSelection({
      value: element.value,
      start: element.selectionStart,
      end: element.selectionEnd,
    });
  }

  function choose(node: ReferenceChoice) {
    if (!mention) return;
    const next = insertDraftMention(value, mention, node.title);
    if (props.maxLength && next.value.length > props.maxLength) {
      setLengthError("这项引用会超出输入长度，请先缩短正文。");
      return;
    }
    if (!onAddReference(node.id)) return;
    pendingCaret.current = next;
    setDismissed(selectionKey(next.value, next.caret));
    onValueChange(next.value);
    input.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const anchor = input.current;
      const panel = popup.current;
      if (!anchor || !panel) return;
      if (document.hidden || anchor.closest("[hidden],[inert]")) {
        setFocused(false);
        return;
      }
      const viewport = window.visualViewport;
      const edgeTop = (viewport?.offsetTop ?? 0) + 8;
      const edgeLeft = (viewport?.offsetLeft ?? 0) + 8;
      const width = (viewport?.width ?? innerWidth) - 16;
      const bottom = edgeTop + (viewport?.height ?? innerHeight) - 16;
      const bounds = anchor.getBoundingClientRect();
      const above = Math.max(0, bounds.top - edgeTop - 8);
      const below = Math.max(0, bottom - bounds.bottom - 8);
      const isAbove = above >= Math.min(200, below);
      panel.style.width = `${Math.max(0, Math.min(bounds.width, width))}px`;
      panel.style.maxHeight = `${isAbove ? above : below}px`;
      const size = panel.getBoundingClientRect();
      placeFloatingPanel(
        panel,
        Math.max(
          edgeLeft,
          Math.min(bounds.left, edgeLeft + width - size.width),
        ),
        Math.max(
          edgeTop,
          isAbove ? bounds.top - size.height - 8 : bounds.bottom + 8,
        ),
      );
    };
    position();
    const stop = afterSurfaceMotion(popup.current, position);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(position);
    if (input.current) observer?.observe(input.current);
    if (popup.current) observer?.observe(popup.current);
    const outside = (event: Event) => {
      if (
        !popup.current?.contains(event.target as Node) &&
        event.target !== input.current
      )
        setFocused(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("visibilitychange", position);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("visibilitychange", position);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, key]);

  useLayoutEffect(() => {
    const next = pendingCaret.current;
    if (!next || next.value !== value || !input.current) return;
    input.current.setSelectionRange(next.caret, next.caret);
    pendingCaret.current = null;
  }, [value, dismissed]);

  useLayoutEffect(() => {
    const menu = list.current;
    const option = menu?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!menu || !option) return;
    const bounds = menu.getBoundingClientRect();
    const target = option.getBoundingClientRect();
    if (target.top < bounds.top) menu.scrollTop += target.top - bounds.top;
    if (target.bottom > bounds.bottom)
      menu.scrollTop += target.bottom - bounds.bottom;
  }, [key, active?.id, open]);

  return (
    <div
      className={styles.root}
      data-assistant-mention-input
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !popup.current?.contains(event.relatedTarget)
        )
          setFocused(false);
      }}
    >
      {slashOpen && slashChoices.length > 0 && container
        ? createPortal(
            <div
              className={styles.popup}
              ref={popup}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                setDismissed(key);
                input.current?.focus({ preventScroll: true });
              }}
            >
              <p className={styles.hint}>↑ ↓ 选择，Enter 载入技能，Esc 关闭</p>
              <div role="listbox" aria-label="常用技能" className={styles.choices}>
                {slashChoices.map((skill, index) => (
                  <button
                    key={skill.id}
                    role="option"
                    aria-selected={index === slashActiveIndex}
                    type="button"
                    tabIndex={-1}
                    onPointerDown={(e) => { if (e.pointerType !== "touch") e.preventDefault(); }}
                    onPointerMove={(e) => { if (e.pointerType === "mouse") setSlashChosen({ key, id: skill.id }); }}
                    onClick={() => chooseSkill(skill)}
                  >
                    <span>/{skill.name}</span>
                  </button>
                ))}
              </div>
            </div>,
            container,
          )
        : null}
      {mention && container
        ? createPortal(
            <div
              className={styles.popup}
              ref={popup}
              data-assistant-mention-popup
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                setDismissed(key);
                input.current?.focus({ preventScroll: true });
              }}
            >
              <p id={hintId} className={styles.hint}>
                {choices.length
                  ? "↑ ↓ 选择，Enter 或 Tab 引用，Esc 关闭"
                  : "没有匹配的未引用对象，换个名称或使用“添加引用”。"}
              </p>
              {lengthError ? (
                <p role="alert" className={styles.error}>
                  {lengthError}
                </p>
              ) : null}
              <div
                ref={list}
                id={listId}
                role="listbox"
                aria-label="引用画布节点"
                className={styles.choices}
              >
                {choices.map((node, index) => (
                  <button
                    id={optionId(index)}
                    key={node.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    type="button"
                    tabIndex={-1}
                    title={node.title}
                    onPointerDown={(event) => {
                      if (event.pointerType !== "touch") event.preventDefault();
                    }}
                    onPointerMove={(event) => {
                      if (event.pointerType === "mouse")
                        setChosen({ key, id: node.id });
                    }}
                    onClick={() => choose(node)}
                  >
                    <span>@{node.title}</span>{" "}
                    <small>
                      {node.kind === "asset" ? "素材" : "工具"}
                      {nodes.filter((item) => item.title === node.title)
                        .length > 1
                        ? ` ${node.id}`
                        : ""}
                    </small>
                  </button>
                ))}
              </div>
            </div>,
            container,
          )
        : null}
      <AssistantComposer
        {...props}
        value={value}
        ref={(element) => {
          input.current = element;
          if (typeof ref === "function") ref(element);
          else if (ref) ref.current = element;
        }}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-controls={mention ? listId : undefined}
        aria-activedescendant={
          mention && active ? optionId(activeIndex) : undefined
        }
        aria-describedby={
          [props["aria-describedby"], mention ? hintId : null]
            .filter(Boolean)
            .join(" ") || undefined
        }
        onChange={(event) => {
          setLengthError("");
          setDismissed("");
          rememberSelection(event.currentTarget);
          onValueChange(event.currentTarget.value);
        }}
        onSelect={(event) => {
          rememberSelection(event.currentTarget);
          props.onSelect?.(event);
        }}
        onFocus={(event) => {
          setFocused(true);
          rememberSelection(event.currentTarget);
          props.onFocus?.(event);
        }}
        onCompositionStart={(event) => {
          setComposing(true);
          props.onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          setComposing(false);
          rememberSelection(event.currentTarget);
          props.onCompositionEnd?.(event);
        }}
        onKeyDown={(event) => {
          // 斜杠技能命令键盘导航（优先于 @ mention）
          if (slashOpen && slashChoices.length > 0 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDismissed(key);
              return;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const index = (slashActiveIndex + (event.key === "ArrowDown" ? 1 : -1) + slashChoices.length) % slashChoices.length;
              const skill = slashChoices[index];
              if (skill) setSlashChosen({ key, id: skill.id });
              return;
            }
            if (!event.shiftKey && event.key === "Enter" && activeSkill && !event.repeat) {
              event.preventDefault();
              chooseSkill(activeSkill);
              return;
            }
          }
          if (mention && !event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDismissed(key);
              return;
            }
            if (
              (event.key === "ArrowDown" || event.key === "ArrowUp") &&
              choices.length
            ) {
              event.preventDefault();
              const index =
                (activeIndex +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  choices.length) %
                choices.length;
              const choice = choices[index];
              if (choice) setChosen({ key, id: choice.id });
              return;
            }
            if (
              !event.shiftKey &&
              (event.key === "Enter" || (event.key === "Tab" && active))
            ) {
              event.preventDefault();
              if (active && !event.repeat) choose(active);
              return;
            }
          }
          props.onKeyDown?.(event);
        }}
      />
    </div>
  );
}
