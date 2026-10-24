"use client";

/* Refactoring UI §2.1/§3.3: current function first; project context secondary.
 * Navigation uses --workspace-nav-width; controls use --control-height. */
import { useState } from "react";
import {
  STUDIO_GROUPS,
  STUDIO_TABS,
  type StudioTab,
} from "./studio-navigation";
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
      {STUDIO_GROUPS.map((group) => (
        <div
          className={styles.navigationGroup}
          key={group.label}
          role="presentation"
        >
          <span className={styles.navigationLabel}>{group.label}</span>
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
                  !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
                )
                  return;
                event.preventDefault();
                const index = STUDIO_TABS.findIndex(
                  (entry) => entry.value === item.value,
                );
                const next =
                  event.key === "Home"
                    ? STUDIO_TABS[0]
                    : event.key === "End"
                      ? STUDIO_TABS.at(-1)
                      : STUDIO_TABS[
                          (index +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            STUDIO_TABS.length) %
                            STUDIO_TABS.length
                        ];
                if (next) {
                  setFocused(next.value);
                  document.getElementById(`${id}-tab-${next.value}`)?.focus();
                }
              }}
            >
              <span>{item.label}</span>
              {value === item.value ? <span aria-hidden="true">›</span> : null}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
