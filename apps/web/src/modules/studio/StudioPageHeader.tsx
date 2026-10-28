import type { ReactNode } from "react";
import styles from "./studio.module.css";

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
  return (
    <header className={styles.surfaceHeading}>
      <div
        data-guide="studio-object"
        data-guide-title={type ?? title}
        data-guide-switcher={objectSwitcher ? "true" : "false"}
        data-guide-revision={guideHasRevision ? "true" : "false"}
      >
        <div className={styles.surfaceTitle}>
          <h2>{title}</h2>
          {status}
        </div>
        {type || description ? (
          <p>{[type, description].filter(Boolean).join(" ")}</p>
        ) : null}
        {objectSwitcher}
      </div>
      {actions ? <div className={styles.surfaceTools}>{actions}</div> : null}
    </header>
  );
}
