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
}: {
  readonly title: string;
  readonly type?: string;
  readonly description?: string;
  readonly status?: ReactNode;
  readonly actions?: ReactNode;
  readonly objectSwitcher?: ReactNode;
}) {
  return (
    <header className={styles.surfaceHeading}>
      <div>
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
