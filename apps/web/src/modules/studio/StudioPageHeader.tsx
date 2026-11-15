"use client";

import { createContext, useContext, type ReactNode } from "react";
import styles from "./studio.module.css";

export const StudioHeaderContext = createContext<{ actions: ReactNode; readOnly: boolean; embedded?: boolean } | null>(null);
export function StudioProjectActions() {
  const context = useContext(StudioHeaderContext);
  return context ? <div className={styles.projectActions}>{context.actions}</div> : null;
}

/** Object identity is shared; the workspace beneath it follows each task. */
export function StudioPageHeader({
  title,
  type,
  description,
  status,
  actions,
  objectSwitcher,
  guideHasRevision = false,
}: {
  readonly title: string;
  readonly type?: string;
  readonly description?: string;
  readonly status?: ReactNode;
  readonly actions?: ReactNode;
  readonly objectSwitcher?: ReactNode;
  readonly guideHasRevision?: boolean;
}) {
  const workspace = useContext(StudioHeaderContext);
  return (
    <header className={styles.surfaceHeading} data-workspace-heading>
      <div
        data-guide="studio-object"
        data-guide-title={type ?? title}
        data-guide-switcher={objectSwitcher ? "true" : "false"}
        data-guide-revision={guideHasRevision ? "true" : "false"}
      >
        <div className={styles.surfaceTitle}>
          <h2>{title}</h2>
          {status}
          {workspace?.readOnly ? <span className={styles.muted}>只读工作区</span> : null}
        </div>
        {type || description ? (
          <p>{[type, description].filter(Boolean).join(" ")}</p>
        ) : null}
        {objectSwitcher}
      </div>
      {actions || workspace ? <div className={styles.surfaceTools}><StudioProjectActions />{actions}</div> : null}
    </header>
  );
}
