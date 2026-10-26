import type { RunwayRunView, StudioSummary } from "@fashion/shared";
import { ImagePreview } from "../../components/ui";
import { useStudioAssetName } from "../studio/studio-object-context";
import styles from "./runway.module.css";

/** Immutable execution inputs are separate from the next-run editable draft. */
export function RunwayInputSnapshot({
  run,
  data,
}: {
  readonly run: RunwayRunView;
  readonly data: StudioSummary;
}) {
  const assetName = useStudioAssetName();
  return (
    <section className={styles.snapshot} aria-label="本次运行的需求快照">
      <div className={styles.formHeader}>
        <div>
          <h3>本次运行的需求快照</h3>
          <p>执行开始时保存的原始需求，后续编辑草稿不会改变这里的内容。</p>
        </div>
      </div>
      <p className={styles.prompt}>{run.inputSnapshot.prompt}</p>
      <dl className={styles.snapshotFacts}>
        <div>
          <dt>计划出场</dt>
          <dd>{run.inputSnapshot.modelCount} 人</dd>
        </div>
        <div>
          <dt>背景音乐</dt>
          <dd>{run.inputSnapshot.withMusic ? "生成背景音乐" : "无配乐"}</dd>
        </div>
        <div>
          <dt>生成模式</dt>
          <dd>
            {run.modelSnapshot.mode === "mock"
              ? "模拟生成"
              : run.modelSnapshot.mode === "live"
                ? "真实供应商"
                : "未记录"}
          </dd>
        </div>
      </dl>
      <ul className={styles.sourceList}>
        {run.inputSnapshot.inputs.map((input, index) => {
          const revision = data.styles
            .flatMap((style) => [style.currentRevision, ...style.revisions])
            .find(
              (item) =>
                input.sourceType === "style_revision" &&
                item.id === input.sourceId,
            );
          const snapshot = run.media.find(
            (media) =>
              media.kind === input.kind &&
              media.source.sourceId === input.sourceId &&
              media.source.sourceType === input.sourceType,
          );
          const assetId =
            input.sourceType === "asset"
              ? input.sourceId
              : revision?.payload.sourceAssetId;
          const source = data.assets.find((asset) => asset.id === assetId);
          const label = revision
            ? `${revision.payload.name} · r${revision.revision}`
            : input.sourceType === "style_revision"
              ? `款式修订 · ${input.sourceId.slice(-8)}`
              : assetId
                ? assetName(assetId)
                : `上传参考图 ${index + 1}`;
          return (
            <li key={`${input.kind}:${input.sourceType}:${input.sourceId}`}>
              <span className={styles.sourceImage}>
                <ImagePreview
                  src={snapshot?.contentUrl ?? source?.url}
                  alt={label}
                />
              </span>
              <span>
                <strong>{label}</strong>
                <small>
                  {input.kind === "model"
                    ? "模特"
                    : input.kind === "cloth"
                      ? "服装"
                      : "背景"}
                  参考 · {snapshot ? "已保存输入快照" : "输入来源"}
                </small>
              </span>
              {snapshot ? (
                <a href={snapshot.contentUrl} target="_blank" rel="noreferrer">
                  查看快照
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!run.inputSnapshot.inputs.length ? (
        <p className={styles.muted}>
          这次运行从文字需求开始，没有引用已有图片。
        </p>
      ) : null}
    </section>
  );
}
