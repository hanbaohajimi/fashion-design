"use client";

/* §2.1/§2.8/§3.6：当前对象和必要输入优先；高级字段以真实摘要收纳。
 * 表面、文字、间距和操作色均来自 design-system.css，不拥有业务草稿或请求。 */
import { Children, cloneElement, isValidElement, useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, Input } from "./ui";
import { GridDetails } from "./GridDetails";
import styles from "./workspace-ui.module.css";

const pendingValidation = new WeakSet<HTMLFormElement>();

/** 原生校验仍覆盖隐藏章节；每轮仅定位第一个错误，防止多个 invalid 事件抢焦点。 */
export function revealInvalidField(
  event: FormEvent<HTMLElement>,
  reveal?: () => void,
) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const form = target.closest("form");
  event.preventDefault();
  if (form && pendingValidation.has(form)) return;
  if (form) pendingValidation.add(form);
  reveal?.();
  for (
    let parent = target.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
  requestAnimationFrame(() => {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "center", behavior: "instant" });
    if (form) pendingValidation.delete(form);
  });
}

export function WorkspaceHeader({
  title,
  description,
  context,
  actions,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly context?: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {context ? <div className={styles.context}>{context}</div> : null}
      </div>
      {actions ? <div className={styles.headerActions}>{actions}</div> : null}
    </header>
  );
}

export function FormSection({
  title,
  summary,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  errors = 0,
}: {
  readonly title: string;
  readonly summary?: ReactNode;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly errors?: number;
}) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const setOpen = (value: boolean) => {
    setExpanded(value);
    onOpenChange?.(value);
  };
  return (
    <GridDetails
      className={styles.section}
      open={open ?? expanded}
      onOpenChange={setOpen}
      onInvalidCapture={(event) =>
        revealInvalidField(event, () => setOpen(true))
      }
    >
      <summary>
        <strong>{title}</strong>
        {summary ? <span>{summary}</span> : null}
        {errors ? (
          <span className={styles.error}>{errors} 项待处理</span>
        ) : null}
      </summary>
      <div className={styles.sectionContent}>{children}</div>
    </GridDetails>
  );
}

export function ActionBar({
  status,
  secondary,
  children,
}: {
  readonly status?: ReactNode;
  readonly secondary?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <footer className={styles.actionBar}>
      <div className={styles.actionStatus}>{status}</div>
      <div className={styles.actionControls}>
        {secondary}
        {children}
      </div>
    </footer>
  );
}

function objectChoiceText(nodes: ReactNode): string {
  return Children.toArray(nodes).map(node => isValidElement<{ children?: ReactNode }>(node) ? objectChoiceText(node.props.children) : String(node)).join("");
}

function filterObjectChoices(nodes: ReactNode, query: string): { nodes: ReactNode; matches: number } {
  let matches = 0;
  const filtered = Children.map(nodes, node => {
    if (!isValidElement<{ children?: ReactNode }>(node)) return node;
    if (node.type === Button || node.type === "button") {
      if (!objectChoiceText(node.props.children).toLocaleLowerCase().includes(query)) return null;
      matches++;
      return node;
    }
    if (!node.props.children) return node;
    const children = filterObjectChoices(node.props.children, query);
    matches += children.matches;
    return cloneElement(node, { children: children.nodes });
  });
  return { nodes: filtered, matches };
}

export function ObjectSwitcher({
  label,
  current,
  children,
}: {
  readonly label: string;
  readonly current: ReactNode;
  readonly children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const filtered = filterObjectChoices(children, query.trim().toLocaleLowerCase());
  return (
    <FormSection title={label} summary={current} onOpenChange={(open) => { if (open) setQuery(""); }}>
      <div className={styles.objectChoicePanel}>
        <Input aria-label={`搜索${label}`} placeholder="搜索已加载对象的名称、编号或修订" value={query} onChange={(event) => setQuery(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
        <div className={styles.objectChoices}>{filtered.nodes}</div>
        {!filtered.matches ? <p role="status">没有匹配的已加载对象</p> : null}
      </div>
    </FormSection>
  );
}

export function EditorChapters({
  chapters,
  active,
  onChange,
}: {
  readonly chapters: readonly {
    value: string;
    label: string;
    pending?: number;
  }[];
  readonly active: string;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <nav className={styles.chapters} aria-label="技术包章节" id={id}>
      {chapters.map(({ value, label, pending }) => (
        <Button
          key={value}
          aria-label={label}
          aria-describedby={pending ? `${id}-${value}-pending` : undefined}
          aria-current={active === value ? "step" : undefined}
          onClick={() => onChange(value)}
        >
          {label}
          {pending ? (
            <small id={`${id}-${value}-pending`}> {pending} 待复核</small>
          ) : null}
        </Button>
      ))}
    </nav>
  );
}
