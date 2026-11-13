"use client";
import { importCanvasMaterials } from "../board/workflow/import-canvas-materials";
import { createAgentConversation } from "../board/agent/agent-api";
import { usePersistentDraft } from "../../components/drafts/use-persistent-draft";
import { GridDetails } from "../../components/GridDetails";

/* refactoring-ui §2.1/§2.8/§3.3：主要内容为简报编辑；来源选择与品牌为次级。存入工作流为唯一主操作，不触发图片生成。 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { studioBrandSchema, type ResearchAnalysis, type StudioDocumentView } from "@fashion/shared";
import type { ResearchSource } from "@fashion/shared";
import type { TrendItem, TrendListPage } from "../trends/trend-types";
import { privateFetch } from "../auth/private-fetch";
import { analyzeResearchSources, searchResearchSources } from "./research-api";
import {
  fetchWorkflow,
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
  analysis?: ResearchAnalysis | null,
): string {
  const profile = studioBrandSchema.safeParse(brand);
  const keywords = [...new Set(articles.flatMap((article) => article.extracted?.keywords ?? article.tags))].slice(0, 24);
  const silhouettes = [...new Set(articles.flatMap((article) => article.extracted?.silhouettes ?? []))].slice(0, 16);
  const fabrics = [...new Set(articles.flatMap((article) => article.extracted?.fabricMentions ?? []))].slice(0, 16);
  const colors = [...new Set(articles.flatMap((article) => article.extracted?.keyColors ?? []))].slice(0, 16);
  return [
    "研究报告：" + goal,
    `证据范围：${articles.length} 条已选来源；以下观察来自来源摘要、关键词与结构化提取，不代表销量、增长率或未来热度事实。`,
    "时间一致性：" + researchDateSummary(articles),
    profile.success
      ? "明确采用的品牌规则（资料快照）：" + JSON.stringify(profile.data)
      : "品牌规则：未指定",
    "观察到的来源信号：",
    `关键词：${keywords.join("、") || "未提取"}`,
    `廓形：${silhouettes.join("、") || "未提取"}`,
    `面料：${fabrics.join("、") || "未提取"}`,
    `色彩：${colors.join("、") || "未提取"}`,
    ...(analysis ? [
      `结构化研究分析（${analysis.mode === "AI" ? "AI归纳" : "来源提取"}）：${analysis.summary}`,
      `分析关键词：${analysis.keywords.join("、") || "未提取"}`,
      `分析廓形：${analysis.silhouettes.join("、") || "未提取"}`,
      `分析面料：${analysis.fabrics.join("、") || "未提取"}`,
      `分析色彩：${analysis.colors.join("、") || "未提取"}`,
      `工作假设：${analysis.hypotheses.join("；") || "未提取"}`,
      `分析未知项：${analysis.unknowns.join("；") || "未提取"}`,
      "来源证据映射：",
      ...analysis.evidence.map((item) => `[${item.sourceId}] ${item.claims.join("；")}`),
    ] : []),
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
    "设计师提出的探索方向（工作假设）：\n" + (directions || "尚待定义，请先讨论方向"),
    "待验证与证据缺口：来源摘要可能不完整；没有销量、增长率或未来热度证据。图片中的色值、材质、结构和真实物性需要设计师结合原文、实物或规格资料复核。",
    "引用来源清单：",
    ...articles.map((article, index) => `[S${index + 1}] ${article.title} · ${article.sourceUrl}`),
  ].join("\n\n");
}

export function researchDateSummary(articles: readonly TrendItem[]): string {
  const dates = articles
    .map((article) => article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN)
    .filter((value) => Number.isFinite(value));
  if (dates.length < 2) return "有效发布日期不足，无法判断来源是否处于同一时间窗口";
  const spanDays = Math.round((Math.max(...dates) - Math.min(...dates)) / (24 * 60 * 60 * 1_000));
  if (spanDays > 180) return `来源时间跨度约 ${spanDays} 天，应按阶段阅读，不要直接合并为同一时点趋势`;
  return `来源时间跨度约 ${spanDays} 天，仍需结合原文判断是否存在阶段差异`;
}

export function buildResearchMoodboardOperations(
  goal: string,
  articles: readonly TrendItem[],
  directions: string,
  brand: unknown,
  analysis?: ResearchAnalysis | null,
): WorkflowOperation[] {
  const reportNodeId = crypto.randomUUID();
  const operations: WorkflowOperation[] = [
    {
      type: "add_node",
      node: {
        id: reportNodeId,
        kind: "asset",
        type: "reference_text",
        title: `研究报告 · ${goal.slice(0, 160)}`,
        x: 80,
        y: 80,
        payload: {
          documentType: "research_report",
          text: buildTrendBrief(goal, articles, directions, brand, analysis),
          ...(analysis ? { analysis } : {}),
          sourceCount: articles.length,
          sourceIds: articles.map((article) => article.id),
          sourceUrls: articles.map((article) => article.sourceUrl),
          brandRevisionId: studioBrandSchema.safeParse(brand).success
            ? studioBrandSchema.parse(brand).copiedFromRevisionId ?? null
            : null,
        },
      },
    },
  ];
  articles.forEach((article, index) => {
    if (!article.coverImageUrl) return;
    operations.push({
      type: "add_node",
      node: {
        id: crypto.randomUUID(),
        kind: "asset",
        type: "reference_image",
        title: `研究图 ${index + 1} · ${article.title}`.slice(0, 200),
        x: 420 + (index % 3) * 280,
        y: 80 + Math.floor(index / 3) * 380,
        payload: {
          imageUrl: article.coverImageUrl,
          sourceUrl: article.sourceUrl,
          trendItemId: article.id,
          platform: article.platform,
          publishedAt: article.publishedAt,
          text: article.summary,
          sourceKind: article.status === "external" ? "EXTERNAL" : "CURATED",
          researchRole: "moodboard",
        },
      },
    });
  });
  const colors = [...new Set(articles.flatMap((article) => article.extracted?.keyColors ?? []))].slice(0, 8);
  colors.forEach((color, index) => {
    operations.push({
      type: "add_node",
      node: {
        id: crypto.randomUUID(),
        kind: "asset",
        type: "swatch",
        title: `研究色彩 ${color}`,
        x: 420 + index * 220,
        y: 80 + Math.ceil(Math.max(articles.filter((article) => Boolean(article.coverImageUrl)).length, 1) / 3) * 380,
        payload: {
          color,
          sourceUrl: articles.find((article) => article.extracted?.keyColors?.includes(color))?.sourceUrl ?? null,
          text: "来自研究来源的结构化色彩提取，需人工核对色准。",
          researchRole: "moodboard_color",
        },
      },
    });
  });
  return operations;
}

function externalSourceAsTrendItem(source: ResearchSource): TrendItem {
  return {
    category: "external",
    coverImageUrl: source.imageUrl,
    curatedAt: source.publishedAt ?? "未知（外部检索）",
    extracted: null,
    id: source.id,
    platform: source.domain,
    publishedAt: source.publishedAt,
    sourceUrl: source.url,
    status: "external",
    summary: source.snippet,
    tags: [],
    title: source.title,
  };
}

function trendItemAsResearchSource(article: TrendItem): ResearchSource {
  let domain = article.platform;
  try {
    domain = new URL(article.sourceUrl).hostname;
  } catch {
    // Keep the curated platform label when the source URL is unavailable.
  }
  const timestamp = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN;
  const freshness: ResearchSource["freshness"] = !Number.isFinite(timestamp)
    ? "UNKNOWN"
    : Date.now() - timestamp <= 180 * 24 * 60 * 60 * 1_000
      ? "RECENT"
      : "DATED";
  return {
    domain,
    freshness,
    id: article.id,
    imageUrl: article.coverImageUrl,
    kind: article.status === "external" ? "EXTERNAL" : "CURATED",
    publishedAt: article.publishedAt,
    snippet: article.summary,
    title: article.title,
    url: article.sourceUrl,
  };
}

function sourceKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href.replace(/\/$/u, "").toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

const freshnessLabels: Record<ResearchSource["freshness"], string> = {
  DATED: "较旧来源",
  RECENT: "近半年来源",
  UNKNOWN: "日期未知",
};
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
  const router = useRouter();
  const [articles, setArticles] = useState<readonly TrendItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [goal, setGoal] = useState("");
  const [directions, setDirections] = useState("");
  const [brandId, setBrandId] = useState("");
  const [externalQuery, setExternalQuery] = useState("");
  const [externalSources, setExternalSources] = useState<readonly ResearchSource[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ResearchAnalysis | null>(null);
  const [analysisSignature, setAnalysisSignature] = useState("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [savedBriefNodeId, setSavedBriefNodeId] = useState<string | null>(null);
  const [savedResearchNodeIds, setSavedResearchNodeIds] = useState<readonly string[]>([]);
  const continueFlight = useRef(false);
  const [loading, setLoading] = useState(true);
  const [baseline, setBaseline] = useState(
    JSON.stringify({ selected: [], goal: "", directions: "", brandId: "" }),
  );
  const signature = JSON.stringify({ selected, goal, directions, brandId });
  usePersistentDraft({ value: { selected, goal, directions, brandId }, baseline, restore: draft => { setSelected(draft.selected); setGoal(draft.goal); setDirections(draft.directions); setBrandId(draft.brandId); } });
  useEffect(() => {
    onDirty?.(signature !== baseline);
    return () => onDirty?.(false);
  }, [signature, baseline, onDirty]);
  const pending = useRef<{
    nodeId: string;
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
  const allArticles = [...articles, ...externalSources.map(externalSourceAsTrendItem)];
  const chosen = allArticles.filter((article) => selected.includes(article.id));
  const brand = brands.find((brand) => brand.id === brandId);
  const researchKeywords = [...new Set(chosen.flatMap((article) => article.extracted?.keywords ?? article.tags))].slice(0, 8);
  const researchColors = [...new Set(chosen.flatMap((article) => article.extracted?.keyColors ?? []))].slice(0, 8);
  const currentAnalysis = analysisSignature === signature ? analysis : null;
  const sourceById = new Map(chosen.map((article) => [article.id, article]));
  const text = buildTrendBrief(
    goal,
    chosen,
    directions,
    brand?.currentRevision.payload,
    currentAnalysis,
  );
  const searchExternal = async () => {
    if (externalQuery.trim().length < 2 || externalLoading) return;
    setExternalLoading(true);
    setExternalError(null);
    try {
      const response = await searchResearchSources(projectId, externalQuery);
      const curatedUrls = new Set(articles.map((article) => sourceKey(article.sourceUrl)));
      setExternalSources(response.items.filter((source) => !curatedUrls.has(sourceKey(source.url))));
    } catch (cause) {
      setExternalError(cause instanceof Error ? cause.message : "外部研究搜索失败");
    } finally {
      setExternalLoading(false);
    }
  };
  const analyzeSources = async () => {
    if (!goal.trim() || !chosen.length || analysisLoading) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const result = await analyzeResearchSources(projectId, {
        directions,
        goal,
        sources: chosen.map(trendItemAsResearchSource),
      });
      setAnalysis(result);
      setAnalysisSignature(signature);
    } catch (cause) {
      setAnalysisError(cause instanceof Error ? cause.message : "研究分析失败");
    } finally {
      setAnalysisLoading(false);
    }
  };
  const continueToAssistant = async () => {
    if (continueFlight.current) return;
    continueFlight.current = true;
    setContinuing(true);
    setError(null);
    try {
      const conversation = await createAgentConversation(projectId, {
        mode: "workflow",
      });
      if (!conversation.id) throw new Error("设计助手会话创建失败");
      const reference = savedBriefNodeId
        ? savedResearchNodeIds.length > 1
          ? `&referenceNodeIds=${encodeURIComponent(savedResearchNodeIds.join(","))}`
          : `&referenceNodeId=${encodeURIComponent(savedBriefNodeId)}`
        : "";
      router.push(
        `/${encodeURIComponent(projectId)}?conversationId=${encodeURIComponent(conversation.id)}&starter=research${reference}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设计助手打开失败");
    } finally {
      continueFlight.current = false;
      setContinuing(false);
    }
  };
  const save = async () => {
    if (!goal.trim() || !chosen.length) {
      setError("请填写设计目标，并至少选择一条来源资料");
      return;
    }
    if (savedBriefNodeId && signature === baseline) {
      setNotice("当前研究报告已经保存；修改来源、目标或探索方向后可创建新修订。");
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
          nodeId,
          text,
          mutationId: crypto.randomUUID(),
          baseRevision: graph.revision,
          operations: buildResearchMoodboardOperations(
            goal,
            chosen,
            directions,
            brand?.currentRevision.payload,
            currentAnalysis,
          ).map((operation, index) => index === 0 && operation.type === "add_node"
            ? {
                ...operation,
                node: {
                  ...operation.node,
                  id: nodeId,
                  title: goal.slice(0, 80),
                  payload: {
                    ...operation.node.payload,
                    sources: chosen.map((article) => ({
                      trendItemId: article.id,
                      sourceUrl: article.sourceUrl,
                      publishedAt: article.publishedAt,
                      curatedAt: article.curatedAt,
                      sourceKind: article.status === "external" ? "EXTERNAL" : "CURATED",
                    })),
                    brandRevisionId: brand?.currentRevision.id ?? null,
                  },
                },
              }
            : operation),
        };
      }
      const patch = pending.current;
      if (!patch) throw new Error("未建立任务简报");
      await importCanvasMaterials(projectId, {
        mode: "semantic",
        mutationId: patch.mutationId,
        baseRevision: patch.baseRevision,
        operations: patch.operations,
      });
      pending.current = null;
      setSavedBriefNodeId(patch.nodeId);
      setSavedResearchNodeIds(
        patch.operations.flatMap((operation) =>
          operation.type === "add_node" ? [operation.node.id] : [],
        ),
      );
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
            <div className={styles.externalResearch} aria-label="外部研究搜索">
              <label>
                外部研究搜索
                <Input
                  value={externalQuery}
                  maxLength={240}
                  placeholder="例如：2027 秋冬通勤风衣 technical fabric"
                  onChange={(event) => setExternalQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void searchExternal();
                    }
                  }}
                />
              </label>
              <Button
                type="button"
                size="small"
                loading={externalLoading}
                disabled={externalQuery.trim().length < 2 || externalLoading}
                onClick={() => void searchExternal()}
              >
                搜索外部来源
              </Button>
              <small>仅返回白名单时尚来源；未配置搜索服务时会明确提示，不会伪造实时结果。</small>
              {externalError ? <p className={styles.externalResearchError} role="alert">{externalError}</p> : null}
              {externalSources.length ? (
                <div className={styles.externalResults} aria-label="外部研究结果">
                  <strong>外部检索结果</strong>
                  {externalSources.map((source) => (
                    <label key={source.id}>
                      <input
                        type="checkbox"
                        disabled={!selected.includes(source.id) && selected.length >= 6}
                        checked={selected.includes(source.id)}
                        onChange={(event) => setSelected((current) => event.target.checked
                          ? [...current, source.id]
                          : current.filter((id) => id !== source.id))}
                      />
                      <span>
                        <strong>{source.title}</strong>
                        <small>{source.domain} · {source.publishedAt?.slice(0, 10) ?? "日期未知"} · {freshnessLabels[source.freshness]}</small>
                        <em>{source.snippet || "没有摘要，请打开原文核对。"}</em>
                        <a href={source.url} target="_blank" rel="noreferrer">查看原文</a>
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
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
                      {article.publishedAt?.slice(0, 10) ?? "发布日期未知"} {" "}
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
              {chosen.map((article) => (
                <article key={article.id}>
                  <h4>{article.title}</h4>
                  <p>{article.summary}</p>
                  <small>
                    {article.publishedAt?.slice(0, 10) ?? "发布日期未知"} {" "}
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
          {selected.length ? (
            <section className={styles.researchLedger} aria-label="研究证据账本">
              <div>
                <strong>证据</strong>
                <span>{chosen.length} 条来源已保留原始链接与日期。</span>
              </div>
              <div>
                <strong>观察</strong>
                <span>{researchKeywords.length ? `${researchKeywords.length} 个关键词信号${researchColors.length ? `，${researchColors.length} 个色彩信号` : ""}` : "尚无结构化关键词"}。</span>
              </div>
              <div>
                <strong>边界与时间</strong>
                <span>{researchDateSummary(chosen)}；销量、热度、物性与色准仍需原文、实物或规格资料核对。</span>
              </div>
            </section>
          ) : null}
          {selected.length ? (
            <section className={styles.analysisPanel} aria-label="结构化研究分析">
              <header>
                <div>
                  <strong>结构化研究分析</strong>
                  <span>{currentAnalysis ? (currentAnalysis.mode === "AI" ? "AI 归纳，仍需核对原文" : "来源提取，未调用 AI") : "先整理来源，再决定哪些结论进入设计约束"}</span>
                </div>
                <Button
                  type="button"
                  size="small"
                  loading={analysisLoading}
                  disabled={!goal.trim() || analysisLoading}
                  onClick={() => void analyzeSources()}
                >
                  {currentAnalysis ? "重新整理分析" : "整理研究分析"}
                </Button>
              </header>
              {analysisError ? <p className={styles.externalResearchError} role="alert">{analysisError}</p> : null}
              {currentAnalysis ? (
                <div className={styles.analysisContent}>
                  <p>{currentAnalysis.summary}</p>
                  <dl>
                    <div><dt>关键词</dt><dd>{currentAnalysis.keywords.join("、") || "未提取"}</dd></div>
                    <div><dt>廓形 / 面料</dt><dd>{[...currentAnalysis.silhouettes, ...currentAnalysis.fabrics].join("、") || "未提取"}</dd></div>
                    <div><dt>未知项</dt><dd>{currentAnalysis.unknowns.join("；") || "未提取"}</dd></div>
                  </dl>
                  {currentAnalysis.evidence.length ? (
                    <div className={styles.analysisEvidence}>
                      <div className={styles.analysisEvidenceHeader}>
                        <strong>来源级依据</strong>
                        <span>{currentAnalysis.evidence.length} 条映射；打开原文核对后再把结论写入设计约束。</span>
                      </div>
                      <ul>
                        {currentAnalysis.evidence.map((item, index) => {
                          const source = sourceById.get(item.sourceId);
                          return (
                            <li key={`${item.sourceId}-${index}`}>
                              <div className={styles.analysisEvidenceSource}>
                                <strong>{source?.title ?? item.sourceId}</strong>
                                <small>
                                  {source
                                    ? `${source.platform} · ${source.publishedAt?.slice(0, 10) ?? "发布日期未知"}`
                                    : "来源标识未匹配到当前选集"}
                                </small>
                                {source ? (
                                  <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                                    查看原文
                                  </a>
                                ) : null}
                              </div>
                              <ul className={styles.analysisEvidenceClaims}>
                                {item.claims.map((claim) => <li key={claim}>{claim}</li>)}
                              </ul>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
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
                <Select searchable
                  disabled={!canEdit || busy}
                  value={brandId}
                  onChange={(event) => setBrandId(event.target.value)}
                >
                  <option value="">本次不指定品牌规则</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.currentRevision.payload.name} 修订{" "}
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
          <GridDetails>
            <summary>查看来源与完整简报</summary>
            <pre>{text}</pre>
          </GridDetails>
          {canEdit ? (
            <ActionBar guideAnchor="studio-actions" status="仅保存简报，不生成图片。">
              <Button
                type="submit"
                variant="primary"
                loading={busy}
                disabled={Boolean(savedBriefNodeId && signature === baseline)}
              >
                {savedBriefNodeId && signature === baseline ? "研究报告已保存" : "存入工作流"}
              </Button>
            </ActionBar>
          ) : null}
          {notice ? (
            <div className={styles.notice} role="status">
              <p>{notice}</p>
              <div className={styles.noticeActions}>
                <Button
                  type="button"
                  variant="primary"
                  loading={continuing}
                  disabled={continuing}
                  onClick={() => void continueToAssistant()}
                >
                  继续到设计助手
                </Button>
                <a href={"/" + encodeURIComponent(projectId)}>返回画布</a>
              </div>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </form>
      </div>
    </section>
  );
}
