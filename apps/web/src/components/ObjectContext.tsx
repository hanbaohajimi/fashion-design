import type { ReactNode } from "react";
import { ImagePreview } from "./ui";
import styles from "./object-context.module.css";

/** The identity comes from the bound revision, never from the last image selected elsewhere. */
export function ObjectContext({
  name,
  code,
  revision,
  image,
  status,
  children,
}: {
  readonly name: string;
  readonly code?: string | undefined;
  readonly revision?: number | undefined;
  readonly image?: string | null | undefined;
  readonly status?: string | undefined;
  readonly children?: ReactNode;
}) {
  return (
    <section
      data-object-context
      className={styles.context}
      aria-label="当前关联作品"
    >
      {image ? (
        <div className={styles.image}>
          <ImagePreview src={image} alt={name} />
        </div>
      ) : null}
      <div className={styles.identity}>
        <strong>{name}</strong>
        <span>
          {[
            code,
            revision === undefined ? undefined : `款式修订 r${revision}`,
            status,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </section>
  );
}
