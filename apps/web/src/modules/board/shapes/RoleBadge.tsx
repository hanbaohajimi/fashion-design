import styles from "./shapes.module.css";

interface RoleBadgeProps {
  readonly role: string;
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  frame: "画框",
  note: "便签",
  output: "输出",
  palette: "色板",
  reference: "参考",
};

export function RoleBadge({ role }: RoleBadgeProps) {
  return (
    <span className={styles.roleBadge} data-role={role}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}
