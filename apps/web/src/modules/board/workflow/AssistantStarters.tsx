import styles from "./assistant-starters.module.css";

const starters = [
  {
    title: "梳理设计方向",
    detail: "先聊风格、场景与限制",
    prompt:
      "我想做一组适合日常通勤的秋冬服装。请先和我讨论风格方向、目标人群和设计限制，暂不生成图片。",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M2 7h10M2 4h7M2 10h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "通勤外套方案",
    detail: "明确版型、配色和数量",
    prompt: "设计一件秋冬通勤风衣，藏蓝色、宽松廓形，保留立领，生成 2 张方案。",
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M4 2l-2 3v7h10V5L10 2H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M4 2c0 2 2 2.5 3 2.5S10 4 10 2" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
];

const referenceStarter = {
  title: "分析参考素材",
  detail: "整理可借鉴的廓形与细节",
  prompt:
    "请分析我引用的参考素材，整理廓形、配色、面料观感和细节的共通点，并区分可观察到的信息与推测，暂不生成图片。",
  icon: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M7 5v2.5l2 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
};

const collectionStarter = {
  title: "规划一个小系列",
  detail: "先确定单品之间的关系",
  prompt:
    "我想规划一个包含外套、上衣和下装的日常通勤小系列。请先帮我梳理统一的设计语言、单品分工和需要补充的信息，暂不生成图片。",
  icon: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8" y="2" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="2" y="8" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8" y="8" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
};

const reviewStarter = {
  title: "审阅当前方案",
  detail: "检查约束、细节与下一步",
  prompt:
    "请审阅当前画布中的服装方案：逐项检查设计要求、廓形与细节的一致性，区分已确认事实、可观察问题和需要人工确认的推测；给出依据、风险和下一步建议，暂不生成图片。",
  icon: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 7a4.5 4.5 0 1 0 9 0 4.5 4.5 0 0 0-9 0Z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 7l1.5 1.5L9 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

export function AssistantStarters({
  disabled,
  hasDraft,
  hasReferences,
  hasCandidates,
  onChoose,
  onReview,
}: {
  disabled: boolean;
  hasDraft: boolean;
  hasReferences: boolean;
  hasCandidates: boolean;
  onChoose: (prompt: string) => void;
  onReview: () => void;
}) {
  const items = [
    ...starters,
    hasReferences ? referenceStarter : collectionStarter,
    ...(hasCandidates ? [reviewStarter] : []),
  ];

  return (
    <div className={styles.root}>
      <span className={styles.overline} aria-hidden="true">设计助手</span>
      <h3 className={styles.title}>先说说你想做的服装</h3>
      <p className={styles.subtitle}>
        {hasDraft
          ? "输入框里已有内容，可以继续完善后发送。"
          : "选一个起点，可以在输入框里继续完善。"}
      </p>
      <div role="group" aria-label="设计起步示例" className={styles.options}>
        {items.map((item) => (
          <button
            key={item.title}
            type="button"
            disabled={disabled || hasDraft}
            onClick={() =>
              item === reviewStarter ? onReview() : onChoose(item.prompt)
            }
          >
            <span className={styles.icon}>{item.icon}</span>
            <strong className={styles.cardTitle}>{item.title}</strong>
            <small className={styles.cardDetail}>{item.detail}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
