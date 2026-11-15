import { WorkspaceIcon, type AssistantIconName } from "./WorkspaceIcon";
import styles from "./assistant-starters.module.css";

export function AssistantStarters({ disabled, hasDraft, hasReferences, hasCandidates, onChoose, onReview, onUpload }: {
  disabled: boolean;
  hasDraft: boolean;
  hasReferences: boolean;
  hasCandidates: boolean;
  onChoose: (prompt: string) => void;
  onReview: () => void;
  onUpload?: (() => void) | undefined;
}) {
  const items: { title: string; icon: AssistantIconName; run: () => void; needsEmpty: boolean }[] = [
    { title: "设计一件服装", icon: "annotate", needsEmpty: true, run: () => onChoose("设计一件秋冬通勤风衣，藏蓝色、宽松廓形，保留立领，生成 2 张方案。") },
    hasReferences
      ? { title: "分析参考素材", icon: "image", needsEmpty: true, run: () => onChoose("请分析我引用的参考素材，整理廓形、配色、面料观感和细节的共通点，暂不生成图片。") }
      : onUpload
        ? { title: "上传参考图片", icon: "image", needsEmpty: false, run: onUpload }
        : { title: "梳理设计方向", icon: "requirements", needsEmpty: true, run: () => onChoose("请先和我讨论服装的风格方向、目标人群和设计限制，暂不生成图片。") },
    hasCandidates
      ? { title: "审阅当前方案", icon: "review", needsEmpty: true, run: onReview }
      : { title: "规划一个小系列", icon: "variation", needsEmpty: true, run: () => onChoose("我想规划一个包含外套、上衣和下装的日常通勤小系列。请先帮我梳理统一的设计语言和单品分工，暂不生成图片。") },
  ];
  return <div className={styles.root}><div role="group" aria-label="设计起步示例" className={styles.options}>
    {items.map(item => <button key={item.title} type="button" disabled={disabled || hasDraft && item.needsEmpty} onClick={item.run}>
      <span className={styles.icon}><WorkspaceIcon name={item.icon} /></span>
      <span className={styles.cardTitle}>{item.title}</span>
      <span className={styles.arrow}><WorkspaceIcon name="arrow_right" /></span>
    </button>)}
  </div></div>;
}
