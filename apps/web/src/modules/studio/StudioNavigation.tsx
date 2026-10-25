"use client";

/* Refactoring UI §2.1/§2.4/§3.6: three common tasks first; specialist groups disclosed on demand.
 * Navigation uses --workspace-nav-width; controls use --control-height. */
import { useState } from "react";
import { STUDIO_GROUPS, type StudioTab } from "./studio-navigation";
import styles from "./studio.module.css";

export function StudioNavigation({
  id,
  value,
  onChange,
}: {
  readonly id: string;
  readonly value: StudioTab;
  readonly onChange: (value: StudioTab) => void;
}) {
  const [focused, setFocused] = useState<StudioTab | null>(null);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const visibleTabs = STUDIO_GROUPS.flatMap((group) =>
    group.label === "常用" ||
    expanded.includes(group.label) ||
    group.items.some((item) => item.value === value)
      ? [...group.items]
      : [],
  );
  return (
    <div
      className={styles.workspaceNavigation}
      role="tablist"
      aria-label="设计工作室功能"
      aria-orientation="vertical"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(null);
      }}
    >
      {STUDIO_GROUPS.map((group) => {
        const active = group.items.some((item) => item.value === value);
        const open =
          group.label === "常用" || active || expanded.includes(group.label);
        return (
          <div
            className={styles.navigationGroup}
            key={group.label}
            role="presentation"
          >
            {group.label === "常用" ? (
              <span className={styles.navigationLabel}>{group.label}</span>
            ) : (
              <button
                type="button"
                className={styles.navigationDisclosure}
                aria-expanded={open}
                aria-controls={`${id}-group-${group.label}`}
                disabled={active}
                onClick={() =>
                  setExpanded((current) =>
                    open
                      ? current.filter((label) => label !== group.label)
                      : [...current, group.label],
                  )
                }
              >
                {group.label}
                <span aria-hidden="true">{open ? "−" : "+"}</span>
              </button>
            )}
            <div id={`${id}-group-${group.label}`} hidden={!open}>
              {group.items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${item.value}`}
                  aria-controls={`${id}-panel-${item.value}`}
                  aria-selected={value === item.value}
                  tabIndex={(focused ?? value) === item.value ? 0 : -1}
                  onClick={() => onChange(item.value)}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowUp", "ArrowDown", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const index = visibleTabs.findIndex(
                      (entry) => entry.value === item.value,
                    );
                    const next =
                      event.key === "Home"
                        ? visibleTabs[0]
                        : event.key === "End"
                          ? visibleTabs.at(-1)
                          : visibleTabs[
                              (index +
                                (event.key === "ArrowDown" ? 1 : -1) +
                                visibleTabs.length) %
                                visibleTabs.length
                            ];
                    if (next) {
                      setFocused(next.value);
                      document
                        .getElementById(`${id}-tab-${next.value}`)
                        ?.focus();
                    }
                  }}
                >
                  <span>{item.label}</span>
                  {value === item.value ? (
                    <span aria-hidden="true">›</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
