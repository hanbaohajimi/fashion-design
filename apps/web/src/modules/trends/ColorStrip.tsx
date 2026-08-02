import styles from "./trends.module.css";

interface ColorStripProps {
  readonly colors: readonly string[];
}

export function ColorStrip({ colors }: ColorStripProps) {
  const validColors = colors.filter((color) => /^#[0-9A-Fa-f]{6}$/u.test(color));
  if (validColors.length === 0) return null;

  return (
    <div className={styles.colorSection}>
      <span>提取色彩</span>
      <div className={styles.colorStrip} role="list">
        {validColors.map((color) => (
          <span
            aria-label={`色彩 ${color.toUpperCase()}`}
            key={color}
            role="listitem"
            style={{ backgroundColor: color }}
            title={color.toUpperCase()}
          />
        ))}
      </div>
    </div>
  );
}
