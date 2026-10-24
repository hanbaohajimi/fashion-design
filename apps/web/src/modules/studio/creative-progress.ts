import type { StudioSummary } from "@fashion/shared";
export function creativeProgress(data: StudioSummary) {
  const records = [
    ...data.styles.map(style => ({ id: style.currentRevision.id, title: style.name, detail: `款式修订 r${style.currentRevision.revision}`, date: style.currentRevision.createdAt, tab: "styles" })),
    ...[...data.techPacks, ...data.samples, ...data.presentationSets, ...data.reviews].map(doc => ({
      id: doc.currentRevision.id, title: doc.type === "TECH_PACK" ? "技术包更新" : doc.type === "SAMPLE_ROUND" ? "样衣反馈更新" : doc.type === "REVIEW" ? "评审记录更新" : "商品展示更新",
      detail: `修订 r${doc.currentRevision.revision}`, date: doc.currentRevision.createdAt,
      tab: doc.type === "TECH_PACK" ? "tech" : doc.type === "SAMPLE_ROUND" ? "samples" : doc.type === "REVIEW" ? "team" : "presentation",
    })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  return { records: records.slice(0, 3), styles: data.styles.length, assets: data.assets.length, packs: data.techPacks.length,
    next: data.styles.length ? { tab: "experiments", title: "探索这件作品的色彩与材质", action: "进入色料实验" } :
      data.assets.length ? { tab: "styles", title: "把候选整理成可延续的款式", action: "比较并保存款式" } :
        { tab: "tasks", title: "从一张草图或一个想法开始", action: "开始设计任务" } };
}
