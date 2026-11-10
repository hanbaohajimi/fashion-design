import styles from "./assistant-starters.module.css";

const starters = [
  {
    title: "梳理设计方向",
    detail: "先聊风格、场景与限制",
    prompt:
      "我想做一组适合日常通勤的秋冬服装。请先和我讨论风格方向、目标人群和设计限制，暂不生成图片。",
  },
  {
    title: "通勤外套方案",
    detail: "明确版型、配色和数量",
    prompt: "设计一件秋冬通勤风衣，藏蓝色、宽松廓形，保留立领，生成 2 张方案。",
  },
];
const referenceStarter = {
  title: "分析参考素材",
  detail: "整理可借鉴的廓形与细节",
  prompt:
    "请分析我引用的参考素材，整理廓形、配色、面料观感和细节的共通点，并区分可观察到的信息与推测，暂不生成图片。",
};
const collectionStarter = {
  title: "规划一个小系列",
  detail: "先确定单品之间的关系",
  prompt:
    "我想规划一个包含外套、上衣和下装的日常通勤小系列。请先帮我梳理统一的设计语言、单品分工和需要补充的信息，暂不生成图片。",
};

export function AssistantStarters({
  disabled,
  hasDraft,
  hasReferences,
  onChoose,
}: {
  disabled: boolean;
  hasDraft: boolean;
  hasReferences: boolean;
  onChoose: (prompt: string) => void;
}) {
  return (
    <div className={styles.root}>
      <p>
        {hasDraft
          ? "输入框里已有内容，可以继续完善后发送。"
          : "选一个起点，修改输入框里的内容后再发送。"}
      </p>
      <div role="group" aria-label="设计起步示例" className={styles.options}>
        {[
          ...starters,
          hasReferences ? referenceStarter : collectionStarter,
        ].map((item) => (
          <button
            key={item.title}
            type="button"
            disabled={disabled || hasDraft}
            onClick={() => onChoose(item.prompt)}
          >
            <span>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </span>
            <span aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
    </div>
  );
}
