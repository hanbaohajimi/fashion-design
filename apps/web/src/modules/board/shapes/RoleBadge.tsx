import styles from "./shapes.module.css";

interface RoleBadgeProps {
  readonly role: string;
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  avoid: "避用",
  detail_ref: "细节",
  fabric_ref: "面料",
  note: "备注",
  palette: "色板",
  silhouette_ref: "廓形",
  style_ref: "风格",
};

export function RoleBadge({ role }: RoleBadgeProps) {
  return (
    <span className={styles.roleBadge} data-role={role}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}
