import { useEditor, type TLShapeId } from "tldraw";

import { requestBoardLabelDesign } from "../board-context";
import styles from "./shapes.module.css";

interface RoleBadgeProps {
  readonly label?: string | undefined;
  readonly role: string;
  readonly shapeId: TLShapeId;
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  avoid: "避用",
  detail_ref: "细节",
  fabric_ref: "面料",
  garment_ref: "成衣",
  note: "灵感",
  palette: "色卡",
  reference_garment: "参考衣",
  silhouette_ref: "廓形",
  style_ref: "风格",
};

export function resolveRoleBadgeLabel(
  role: string,
  label?: string | undefined,
): string {
  return label?.trim() || ROLE_LABELS[role] || role;
}

export function RoleBadge({ label, role, shapeId }: RoleBadgeProps) {
  const editor = useEditor();
  const displayLabel = resolveRoleBadgeLabel(role, label);

  return (
    <button
      aria-label={`编辑标签：${displayLabel}`}
      className={styles.roleBadge}
      data-label-design-trigger="true"
      data-role={role}
      onClick={(event) => {
        event.stopPropagation();
        editor.select(shapeId);
        requestBoardLabelDesign(shapeId);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      type="button"
    >
      {displayLabel}
    </button>
  );
}
