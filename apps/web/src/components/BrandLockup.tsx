import Image from "next/image";
import styles from "./brand-lockup.module.css";

interface BrandLockupProps {
  readonly tone?: "light" | "color";
  readonly size?: number;
  readonly showText?: boolean;
  readonly className?: string | undefined;
}

export function BrandLockup({
  tone = "color",
  size = 44,
  showText = true,
  className = "",
}: BrandLockupProps) {
  const source =
    tone === "light"
      ? "/branding/logo-navigation-light-256.webp"
      : `/branding/logo-original-transparent-${size > 128 ? 1024 : 256}.webp`;

  return (
    <span className={`${styles.brand} ${className}`}>
      <Image
        alt={showText ? "" : "森织"}
        className={styles.mark}
        height={size}
        loading="eager"
        src={source}
        unoptimized
        width={size}
      />
      {showText ? (
        <span className={styles.wordmark}>
          <span className={styles.name}>森织</span>
          <span className={styles.description}>设计工作室</span>
        </span>
      ) : null}
    </span>
  );
}
