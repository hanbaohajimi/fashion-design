"use client";

/**
 * 命令面板 (⌘K) — 前端 fuzzy 过滤，全键盘可操作。
 *
 * 用法：
 *   const { open, close, toggle } = useCommandPalette();
 *   <CommandPalette commands={commands} />
 *
 * 注册全局快捷键 ⌘K / Ctrl+K，或调用 open() 手动打开。
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { Dialog } from "./ui";
import styles from "./command-palette.module.css";

export interface Command {
  readonly id: string;
  readonly label: string;
  /** 次级描述（路径、快捷键等） */
  readonly description?: string;
  /** 分组名，相同值归为一组 */
  readonly group?: string;
  /** 执行命令 */
  readonly onSelect: () => void;
  /** 是否禁用 */
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
}

interface CommandPaletteProps {
  readonly commands: readonly Command[];
  readonly placeholder?: string;
  /** 受控开关；不传则内部管理 */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
}

/** 简单的 fuzzy 匹配：query 中每个字符依次出现在 target 中即通过 */
function fuzzyMatch(target: string, query: string): boolean {
  if (!query) return true;
  const t = target.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  for (const character of q) {
    const idx = t.indexOf(character, ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

function filterCommands(commands: readonly Command[], query: string): Command[] {
  if (!query.trim()) return [...commands];
  return commands.filter(
    (c) =>
      !c.disabled &&
      (fuzzyMatch(c.label, query) ||
        (c.description != null && fuzzyMatch(c.description, query)) ||
        (c.group != null && fuzzyMatch(c.group, query))),
  );
}

function groupCommands(commands: Command[]): Array<{ group: string | undefined; items: Command[] }> {
  const groups = new Map<string | undefined, Command[]>();
  for (const cmd of commands) {
    const key = cmd.group;
    const items = groups.get(key) ?? [];
    items.push(cmd);
    groups.set(key, items);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

export function CommandPalette({
  commands,
  placeholder = "搜索命令或页面…",
  open: controlledOpen,
  onOpenChange,
}: CommandPaletteProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value);
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange],
  );

  // The search session unmounts on close, including controlled closes.
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);
  return open ? <CommandPaletteSession commands={commands} placeholder={placeholder} onClose={() => setOpen(false)} /> : null;
}

function CommandPaletteSession({ commands, placeholder, onClose }: { commands: readonly Command[]; placeholder: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [requestedIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = filterCommands(commands, query);
  const grouped = groupCommands(filtered);
  const activeIndex = Math.max(0, Math.min(requestedIndex, filtered.length - 1));
  const activeCommand = filtered[activeIndex];

  // Synchronize focus with the mounted dialog.
  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>("[aria-selected='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, query, commands]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex(Math.min(activeIndex + 1, Math.max(0, filtered.length - 1)));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex(Math.max(activeIndex - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const cmd = filtered[activeIndex];
        if (cmd && !cmd.disabled) {
          cmd.onSelect();
          onClose();
        }
        break;
      }
      case "Escape":
        onClose();
        break;
    }
  };

  let flatIndex = -1;

  return (
    <Dialog open onClose={onClose} variant="guide" label="命令面板">
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className={styles.searchRow}>
          <svg className={styles.searchIcon} viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className={styles.searchInput}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={activeCommand ? `cmd-${activeCommand.id}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className={styles.escKbd} aria-label="Escape 关闭">Esc</kbd>
        </div>

        {/* Results */}
        <ul
          id={listboxId}
          ref={listRef}
          className={styles.list}
          role="listbox"
          aria-label="命令列表"
        >
          {filtered.length === 0 && (
            <li className={styles.empty} role="option" aria-selected="false">
              没有匹配的命令
            </li>
          )}
          {grouped.map(({ group, items }) => (
            <li key={group ?? "__root"} role="presentation" className={styles.group}>
              {group && <div className={styles.groupLabel} role="presentation">{group}</div>}
              <ul role="presentation" className={styles.groupItems}>
                {items.map((cmd) => {
                  flatIndex++;
                  const idx = flatIndex;
                  const isActive = idx === activeIndex;
                  return (
                    <li
                      key={cmd.id}
                      id={`cmd-${cmd.id}`}
                      role="option"
                      aria-selected={isActive}
                      aria-disabled={cmd.disabled}
                      className={`${styles.item} ${isActive ? styles.itemActive : ""} ${cmd.disabled ? styles.itemDisabled : ""}`}
                      onPointerEnter={() => setActiveIndex(idx)}
                      onClick={() => {
                        if (!cmd.disabled) {
                          cmd.onSelect();
                          onClose();
                        }
                      }}
                    >
                      {cmd.icon && <span className={styles.itemIcon} aria-hidden="true">{cmd.icon}</span>}
                      <span className={styles.itemLabel}>{cmd.label}</span>
                      {cmd.description && <span className={styles.itemDesc}>{cmd.description}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

/** 命令面板状态 hook，用于从外部控制开关 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  return {
    open,
    isOpen: open,
    openPalette: () => setOpen(true),
    closePalette: () => setOpen(false),
    toggle: () => setOpen((v) => !v),
    setOpen,
  };
}
