"use client";
import { Menu } from "../../../components/ui";
import WarmTooltip from "../../../components/WarmTooltip";
import { WorkspaceIcon } from "./WorkspaceIcon";
import styles from "./node-entry.module.css";

export function AddNodeMenu({ disabled, onCreate, onUpload, onExisting }: { disabled: boolean; onCreate: (kind: "image" | "text" | "video") => void; onUpload: () => void; onExisting: () => void }) {
  return <WarmTooltip content="添加节点" triggerSelector="summary"><Menu nativeTitle={false} className={styles.addMenu} popupClassName={styles.nodeMenuPopup} label="添加节点" disabled={disabled} trigger={<WorkspaceIcon name="add" />} align="start">
    <span className={styles.menuLabel}>添加节点</span>
    <button className={styles.menuEntry} disabled={disabled} onClick={() => onCreate("text")}><WorkspaceIcon name="text_edit" />文本</button>
    <button className={styles.menuEntry} disabled={disabled} onClick={() => onCreate("image")}><WorkspaceIcon name="image" />图片</button>
    <button className={styles.menuEntry} disabled={disabled} onClick={() => onCreate("video")}><WorkspaceIcon name="video" />视频</button>
    <div className={styles.menuDivider} />
    <span className={styles.menuLabel}>添加资源</span>
    <button className={styles.menuEntry} disabled={disabled} onClick={onUpload}><WorkspaceIcon name="share" />上传</button>
    <button className={styles.menuEntry} disabled={disabled} onClick={onExisting}><WorkspaceIcon name="history" />从已有资源选择</button>
  </Menu></WarmTooltip>;
}
