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
  note: "备注",
  palette: "色板",
  silhouette_ref: "廓形",
  style_ref: "风格",
};

export function RoleBadge({ label, role, shapeId }: RoleBadgeProps) {
  const editor = useEditor();
  const displayLabel = label?.trim() || ROLE_LABELS[role] || role;

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
