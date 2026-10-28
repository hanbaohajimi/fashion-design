"use client";

/* Refactoring UI §2.1/§2.4/§3.6: three common tasks first; specialist groups disclosed on demand.
 * Navigation uses --workspace-nav-width; controls use --control-height. */
import { useEffect, useState } from "react";
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
  useEffect(() => {
    let frame = 0;
    let active = true;
    const selected = document.getElementById(`${id}-tab-${value}`);
    const container = selected?.closest("[data-workspace-navigation-scroll]");
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active || !(container instanceof HTMLElement) || !selected?.getBoundingClientRect().height) return;
        const bounds = selected.getBoundingClientRect();
        const viewport = container.getBoundingClientRect();
        container.scrollTop += bounds.top - viewport.top - (container.clientHeight - bounds.height) / 2;
      });
    };
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reveal);
    if (container) resize?.observe(container);
    const navigation = selected?.closest("[data-studio-hierarchy]");
    if (navigation) resize?.observe(navigation);
    void document.fonts.ready.then(reveal);
    document.fonts.addEventListener("loadingdone", reveal);
    reveal();
    return () => { active = false; cancelAnimationFrame(frame); resize?.disconnect(); document.fonts.removeEventListener("loadingdone", reveal); };
  }, [id, value]);
  const visibleTabs = STUDIO_GROUPS.flatMap((group) => [...group.items]);
  return (
    <div
      className={styles.workspaceNavigation}
      data-studio-hierarchy
      role="tablist"
      aria-label="设计工作室功能"
      aria-orientation="vertical"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(null);
      }}
    >
      {STUDIO_GROUPS.map((group) => {
        return (
          <div
            className={styles.navigationGroup}
            key={group.label}
            role="presentation"
          >
            <span className={styles.navigationLabel}>{group.label}</span>
            <div id={`${id}-group-${group.label}`}>
              {group.items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  data-guide={value === item.value ? "studio-navigation" : undefined}
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
