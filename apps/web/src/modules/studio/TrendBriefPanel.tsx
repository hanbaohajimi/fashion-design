"use client";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为简报编辑；来源选择与品牌为次级。存入工作流为唯一主操作，不触发图片生成。 */
import { useEffect, useRef, useState } from "react";
import { studioBrandSchema, type StudioDocumentView } from "@fashion/shared";
import type { TrendItem, TrendListPage } from "../trends/trend-types";
import { privateFetch } from "../auth/private-fetch";
import {
  fetchWorkflow,
  patchWorkflow,
  type WorkflowOperation,
} from "../board/workflow/workflow-api";
import {
  Button,
  Input,
  Select,
  Textarea,
  ImagePreview,
} from "../../components/ui";
import styles from "./trend-brief.module.css";
import { ActionBar, FormSection } from "../../components/workspace-ui";
import { StudioEditSection } from "./StudioEditSection";
import { StudioPageHeader } from "./StudioPageHeader";
export function buildTrendBrief(
  goal: string,
  articles: readonly TrendItem[],
  directions: string,
  brand: unknown,
): string {
  const profile = studioBrandSchema.safeParse(brand);
  return [
    "设计目标：" + goal,
    profile.success
      ? "明确采用的品牌规则（资料快照）：" + JSON.stringify(profile.data)
      : "品牌规则：未指定",
    "来源资料（AI摘要，需结合原文核实）：",
    ...articles.map(
      (article, index) =>
        index +
        1 +
        ". " +
        article.title +
        "\n原文：" +
        article.sourceUrl +
        "\n发布日期：" +
        (article.publishedAt ?? "未知") +
        "\n收录时间：" +
        article.curatedAt +
        "\n已有摘要：" +
        article.summary +
        "\n提取关键词：" +
        (article.extracted?.keywords ?? article.tags).join("、"),
    ),
    "设计师提出的探索方向：\n" + (directions || "尚待定义，请先讨论方向"),
    "待验证：来源摘要可能不完整；没有销量、增长率或未来热度证据。图片中的色值、材质与结构需要设计师复核。",
  ].join("\n\n");
}
export function TrendBriefPanel({
  projectId,
  brands,
  canEdit = true,
  onDirty,
}: {
  projectId: string;
  brands: readonly StudioDocumentView[];
  canEdit?: boolean;
  onDirty?: (dirty: boolean) => void;
}) {
  const [articles, setArticles] = useState<readonly TrendItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [goal, setGoal] = useState("");
  const [directions, setDirections] = useState("");
  const [brandId, setBrandId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [baseline, setBaseline] = useState(
    JSON.stringify({ selected: [], goal: "", directions: "", brandId: "" }),
  );
  const signature = JSON.stringify({ selected, goal, directions, brandId });
  useEffect(() => {
    onDirty?.(signature !== baseline);
    return () => onDirty?.(false);
  }, [signature, baseline, onDirty]);
  const pending = useRef<{
    text: string;
    mutationId: string;
    baseRevision: number;
    operations: WorkflowOperation[];
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void privateFetch("/api/trends?limit=60&page=1", {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("趋势资料读取失败");
        return response.json() as Promise<TrendListPage>;
      })
      .then(
        (result) => setArticles(result.items),
        (cause: unknown) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : "读取失败");
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  const chosen = articles.filter((article) => selected.includes(article.id));
  const brand = brands.find((brand) => brand.id === brandId);
  const text = buildTrendBrief(
    goal,
    chosen,
    directions,
    brand?.currentRevision.payload,
  );
  const save = async () => {
    if (!goal.trim() || !chosen.length) {
      setError("请填写设计目标，并至少选择一条来源资料");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (pending.current?.text !== text) {
        const graph = await fetchWorkflow(projectId);
        const nodeId = crypto.randomUUID();
        pending.current = {
          text,
          mutationId: crypto.randomUUID(),
          baseRevision: graph.revision,
          operations: [
            {
              type: "add_node",
              node: {
                id: nodeId,
                kind: "asset",
                type: "reference_text",
                title: goal.slice(0, 80),
                x: 80,
                y: 80,
                payload: {
                  text,
                  sources: chosen.map((article) => ({
                    trendItemId: article.id,
                    sourceUrl: article.sourceUrl,
                    publishedAt: article.publishedAt,
                    curatedAt: article.curatedAt,
                  })),
                  brandRevisionId: brand?.currentRevision.id ?? null,
                },
              },
            },
          ],
        };
      }
      const patch = pending.current;
      if (!patch) throw new Error("未建立任务简报");
      await patchWorkflow(projectId, {
        mode: "semantic",
        mutationId: patch.mutationId,
        baseRevision: patch.baseRevision,
        operations: patch.operations,
      });
      pending.current = null;
      setBaseline(signature);
      onDirty?.(false);
      setNotice(
        "任务简报已保存到画布，可连接需求分析或引用给设计助手。尚未执行图片生成。",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel}>
      <StudioPageHeader
        title="趋势简报"
        description="选择来源，填写本轮目标和探索方向。品牌规则、原始链接和未知项会一同保存到画布。"
      />
      {loading ? <p role="status">正在读取趋势档案…</p> : null}
      <div className={styles.layout}>
        <div>
          <FormSection
            title="选择趋势来源"
            summary={`已选 ${selected.length} 篇，最多 6 篇`}
            defaultOpen
          >
            <div className={styles.sources}>
              {articles.map((article) => (
                <label key={article.id}>
                  <input
                    type="checkbox"
                    disabled={
                      !canEdit ||
                      busy ||
                      (!selected.includes(article.id) && selected.length >= 6)
                    }
                    checked={selected.includes(article.id)}
                    onChange={(event) =>
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, article.id]
                          : current.filter((id) => id !== article.id),
                      )
                    }
                  />
                  {article.coverImageUrl ? (
                    <span className={styles.sourceImage}>
                      <ImagePreview
                        retryable={false}
                        src={article.coverImageUrl}
                        alt=""
                        fit="cover"
                      />
                    </span>
                  ) : null}
                  <span>
                    <strong>{article.title}</strong>
                    <small>
                      {article.publishedAt?.slice(0, 10) ?? "发布日期未知"} ·{" "}
                      <a
                        href={article.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看原文
                      </a>
                    </small>
                  </span>
                </label>
              ))}
              {!loading && !articles.length ? (
                <p>
                  尚无可用来源。先到趋势档案添加或等待资料更新；没有来源时不会自动编造简报。
                </p>
              ) : null}
            </div>
          </FormSection>
          {selected.length ? (
            <section className={styles.reading} aria-label="本轮趋势简报">
              <h3>{goal || "本轮设计目标待填写"}</h3>
              <p>{directions || "选择来源后，写下希望探索的设计方向。"}</p>
              {articles
                .filter((article) => selected.includes(article.id))
                .map((article) => (
                  <article key={article.id}>
                    <h4>{article.title}</h4>
                    <p>{article.summary}</p>
                    <small>
                      {article.publishedAt?.slice(0, 10) ?? "发布日期未知"} ·{" "}
                      <a
                        href={article.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看原文
                      </a>
                    </small>
                  </article>
                ))}
            </section>
          ) : null}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <StudioEditSection
            persistent
            title="编辑简报方向"
            summary={goal || "填写本轮目标"}
            defaultOpen
            save={canEdit}
            busy={busy}
            error={error}
          >
            <label>
              设计任务
              <Input
                required
                disabled={!canEdit || busy}
                value={goal}
                maxLength={120}
                placeholder="例如：为春夏通勤系列开发轻薄衬衫"
                onChange={(event) => setGoal(event.target.value)}
              />
            </label>
            <FormSection
              title="品牌关联"
              summary={
                brandId
                  ? `已关联：${brands.find((brand) => brand.id === brandId)?.currentRevision.payload.name ?? "当前品牌"}`
                  : "未关联品牌"
              }
            >
              <label>
                采用的品牌资料
                <Select
                  disabled={!canEdit || busy}
                  value={brandId}
                  onChange={(event) => setBrandId(event.target.value)}
                >
                  <option value="">本次不指定品牌规则</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.currentRevision.payload.name} · 修订{" "}
                      {brand.version}
                    </option>
                  ))}
                </Select>
              </label>
            </FormSection>
            <label>
              本轮探索方向，每行一个
              <Textarea
                disabled={!canEdit || busy}
                value={directions}
                rows={5}
                maxLength={2000}
                onChange={(event) => setDirections(event.target.value)}
                placeholder="写出希望探索的廓形、配色或面料；这些是设计建议，不是来源事实"
              />
            </label>
          </StudioEditSection>
          <details>
            <summary>查看来源与完整简报</summary>
            <pre>{text}</pre>
          </details>
          {canEdit ? (
            <ActionBar status="仅保存简报，不生成图片。">
              <Button type="submit" variant="primary" loading={busy}>
                存入工作流
              </Button>
            </ActionBar>
          ) : null}
          {notice ? (
            <p role="status">
              {notice}
              <a href={"/" + encodeURIComponent(projectId)}>返回画布</a>
            </p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </form>
      </div>
    </section>
  );
}
