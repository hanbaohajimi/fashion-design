"use client";
import { GridDetails } from "../../components/GridDetails";
import { StudioCount } from "./StudioCount";
import type { StudioSummary } from "@fashion/shared";
import { creativeProgress } from "./creative-progress";
import styles from "./creative-progress.module.css";
export function CreativeProgress({
  data,
  onNavigate,
  expanded = false,
}: {
  data: StudioSummary;
  onNavigate: (tab: string) => void;
  expanded?: boolean;
}) {
  const progress = creativeProgress(data);
  return (
    <GridDetails open={expanded || undefined} className={styles.frame}>
      <summary>
        创作进展{" "}
        <span>
          {progress.styles} 款档案 {progress.assets} 张候选
        </span>
      </summary>
      <section className={styles.progress} aria-label="创作进展">
        <div className={styles.next}>
          <span className={styles.kicker}>让设计继续生长</span>
          <h2>{progress.next.title}</h2>
          <div className={styles.actions}>
            <button type="button" onClick={() => onNavigate(progress.next.tab)}>
              {progress.next.action} <span aria-hidden="true">↗</span>
            </button>
            <button type="button" onClick={() => onNavigate("planning")}>
              查看系列规划
            </button>
          </div>
          <p>
            {progress.styles} 款档案 {progress.assets} 张候选 {" "}
            {progress.packs} 份技术包
          </p>
        </div>
        <div className={styles.activity}>
          <h3>最近的创作记录</h3>
          {progress.records.length ? (
            <ol>
              {progress.records.map((record) => (
                <li key={record.id}>
                  <button type="button" onClick={() => onNavigate(record.tab)}>
                    <strong>{record.title}</strong>
                    <span>
                      {record.detail} {" "}
                      <time dateTime={record.date}>
                        {new Date(record.date).toLocaleDateString("zh-CN")}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p>保存款式、整理样衣或完成评审后，修订记录会留在这里。</p>
          )}
        </div>
        <nav className={styles.directory} aria-label="工作室资料接续">
          {[
            {
              tab: "brand",
              label: "品牌资料",
              count: data.brandProfiles.length,
            },
            { tab: "patterns", label: "印花习作", count: data.patterns.length },
            {
              tab: "presentation",
              label: "商品展示",
              count: data.presentationSets.length,
            },
            { tab: "tech", label: "技术包", count: data.techPacks.length },
            { tab: "samples", label: "样衣反馈", count: data.samples.length },
            { tab: "team", label: "评审记录", count: data.reviews.length },
          ].map((item) => (
            <button
              key={item.tab}
              type="button"
              onClick={() => onNavigate(item.tab)}
            >
              {item.label} <StudioCount value={item.count} />
            </button>
          ))}
        </nav>
      </section>
    </GridDetails>
  );
}
