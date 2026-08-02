"use client";

import { useEditor, useValue } from "tldraw";
import { ElementRolePanel } from "./ElementRolePanel";
import { isRoleAssignableShape } from "./shapes";
import styles from "./context-inspector.module.css";

export function ContextInspector() {
  const editor = useEditor();
  const selection = useValue(
    "inspector-selection",
    () => {
      const shapes = editor.getSelectedShapes();
      const roleAssignable = shapes.filter(isRoleAssignableShape);
      return {
        count: shapes.length,
        hasRoleAssignable: roleAssignable.length > 0,
      };
    },
    [editor],
  );

  // 如果选中了可标注role的元素，显示role面板
  if (selection.hasRoleAssignable) {
    return (
      <aside className={styles.inspector} aria-label="上下文检视器">
        <ElementRolePanel embedded />
      </aside>
    );
  }

  // 未选中元素时，显示项目概览
  return (
    <aside className={styles.inspector} aria-label="上下文检视器">
      <div className={styles.inspectorEmpty}>
        <header className={styles.inspectorHeader}>
          <span>CONTEXT / OVERVIEW</span>
          <strong>项目概览</strong>
        </header>
        <div className={styles.inspectorContent}>
          <p className={styles.emptyHint}>
            选中画布元素后，这里将显示角色标注、属性和操作。
          </p>
          <dl className={styles.statsList}>
            <div>
              <dt>当前选中</dt>
              <dd>{selection.count} 项</dd>
            </div>
            <div>
              <dt>画布元素</dt>
              <dd>{editor.getCurrentPageShapes().length} 个</dd>
            </div>
          </dl>
        </div>
      </div>
    </aside>
  );
}
