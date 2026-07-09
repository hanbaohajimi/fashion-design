import { useState, useEffect, useRef, useCallback } from 'react';
import {
  RefreshCw, FileText, Monitor, ChevronDown, ChevronUp,
  ExternalLink, Copy, Check, AlertCircle,
} from 'lucide-react';
import type { ReportDetail, TrendItem, StyleDetail, SourceArticleDetail } from '../types';
import { fetchReportDetail } from '../trendApi';
import { shouldShowLegacyTrendFrame } from '../utils';

// ── Pure helpers ───────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return iso; }
}

// Backend may use either field; pick whichever is non-zero/non-empty
function trendName(t: TrendItem): string {
  return String((t as Record<string, unknown>).trend_name ?? t.name ?? '未命名');
}

function trendDesc(t: TrendItem): string {
  return String(t.description ?? (t as Record<string, unknown>).desc ?? '');
}

function trendConf(t: TrendItem): number {
  const v = t.confidence ?? (t as Record<string, unknown>).confidence_score;
  return typeof v === 'number' ? v : 0;
}

function trendEvidence(t: TrendItem) {
  const ev = t.supporting_evidence ?? (t as Record<string, unknown>).evidence;
  return Array.isArray(ev) ? ev : [];
}

// ── Atom components ────────────────────────────────────────

function ConfBar({ value }: { value: number }) {
  if (!value) return null;
  const pct = Math.round(value * 100);
  return (
    <div className="rdt-conf-wrap" title={`置信度 ${pct}%`}>
      <div className="rdt-conf-bar">
        <div className="rdt-conf-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="rdt-conf-label">{pct}%</span>
    </div>
  );
}

function DirBadge({ dir }: { dir?: string }) {
  if (!dir) return null;
  const icon = dir === '上升' ? '↑' : dir === '新兴' ? '★' : dir === '稳定' ? '→' : '';
  const cls = dir === '上升' ? 'rdt-badge rdt-badge--up'
    : dir === '新兴' ? 'rdt-badge rdt-badge--new'
    : 'rdt-badge rdt-badge--stable';
  return <span className={cls}>{icon} {dir}</span>;
}

function RelatedRow({ label, items, colorSwatch }: { label: string; items?: string[]; colorSwatch?: boolean }) {
  if (!items?.length) return null;
  return (
    <div className="rdt-related-row">
      <span className="rdt-related-label">{label}</span>
      <div className="rdt-related-tags">
        {items.slice(0, 6).map((t, i) => (
          <span key={i} className="rdt-tag">
            {colorSwatch && <ColorDot name={t} />}
            {t}
          </span>
        ))}
        {items.length > 6 && <span className="rdt-tag rdt-tag--more">+{items.length - 6}</span>}
      </div>
    </div>
  );
}

function ColorDot({ name }: { name: string }) {
  return (
    <span
      className="rdt-color-dot"
      style={{ background: guessColorHex(name) }}
      title={name}
    />
  );
}

// Crude hex guesser — first valid hex-looking token wins, else placeholder
function guessColorHex(name: string): string {
  const m = name.match(/#[0-9A-Fa-f]{6}/);
  return m ? m[0] : '#3a3a3a';
}

function ImageGrid({ urls, max = 6 }: { urls?: string[]; max?: number }) {
  if (!urls?.length) return null;
  return (
    <div className="rdt-image-grid">
      {urls.slice(0, max).map((url, i) => (
        <img
          key={i}
          src={url}
          alt=""
          className="rdt-grid-img"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ))}
    </div>
  );
}

function ImageStrip({ urls, max = 3 }: { urls?: string[]; max?: number }) {
  if (!urls?.length) return null;
  return (
    <div className="rdt-images">
      {urls.slice(0, max).map((url, i) => (
        <img
          key={i}
          src={url}
          alt=""
          className="rdt-img"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ))}
    </div>
  );
}

function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard access denied, silently ignore */ }
  }, [text]);

  return (
    <button type="button" onClick={() => void handleCopy()} className="rdt-copy-btn" title="复制到剪贴板">
      {copied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.5} />}
      {copied ? '已复制' : label}
    </button>
  );
}

// ── Trend card ────────────────────────────────────────────

function TrendCard({ trend, index }: { trend: TrendItem; index: number }) {
  const [open, setOpen] = useState(index < 3);
  const name = trendName(trend);
  const desc = trendDesc(trend);
  const conf = trendConf(trend);
  const evidence = trendEvidence(trend);
  const dir = trend.trend_direction as string | undefined;

  return (
    <div className="rdt-trend-card">
      <button type="button" className="rdt-trend-card-header" onClick={() => setOpen(o => !o)}>
        <div className="rdt-trend-card-title">
          <span className="rdt-trend-name">{name}</span>
          {trend.category && <span className="rdt-badge rdt-badge--cat">{String(trend.category)}</span>}
        </div>
        <div className="rdt-trend-card-meta">
          <DirBadge dir={dir} />
          <ConfBar value={conf} />
          {open ? <ChevronUp size={13} strokeWidth={1.5} /> : <ChevronDown size={13} strokeWidth={1.5} />}
        </div>
      </button>

      {open && (
        <div className="rdt-trend-card-body">
          <ImageStrip urls={trend.selected_images} />
          {desc && <p className="rdt-trend-desc">{desc}</p>}

          <RelatedRow label="色彩" items={trend.related_colors as string[] | undefined} colorSwatch />
          <RelatedRow label="面料" items={trend.related_fabrics as string[] | undefined} />
          <RelatedRow label="单品" items={trend.related_items as string[] | undefined} />
          <RelatedRow label="廓形" items={trend.related_silhouettes as string[] | undefined} />
          <RelatedRow label="图案" items={trend.related_patterns as string[] | undefined} />

          {evidence.length > 0 && (
            <details className="rdt-evidence-toggle">
              <summary className="rdt-evidence-summary">
                证据来源 ({evidence.length})
              </summary>
              <div className="rdt-evidence">
                {evidence.slice(0, 3).map((e, i) => {
                  const ev = e as Record<string, unknown>;
                  return (
                    <div key={i} className="rdt-evidence-item">
                      {ev.site_name != null && <span className="rdt-evidence-site">{String(ev.site_name)}</span>}
                      {ev.article_url
                        ? (
                          <a
                            href={String(ev.article_url)}
                            target="_blank"
                            rel="noreferrer"
                            className="rdt-evidence-title"
                          >
                            {String(ev.article_title ?? ev.title ?? ev.article_url)}
                          </a>
                        )
                        : <span className="rdt-evidence-title">{String(ev.article_title ?? ev.snippet ?? '')}</span>
                      }
                      {ev.snippet != null && <p className="rdt-evidence-snippet">{String(ev.snippet)}</p>}
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Style detail card ─────────────────────────────────────

function StyleCard({ item }: { item: StyleDetail }) {
  const tips = item.style_tips as string[] | undefined;
  return (
    <div className="rdt-style-card">
      <div className="rdt-style-header">
        <span className="rdt-style-name">{item.name ?? '—'}</span>
        <DirBadge dir={item.trend_direction} />
      </div>
      {item.confidence != null && item.confidence > 0 && (
        <ConfBar value={item.confidence} />
      )}
      <ImageStrip urls={item.selected_images} />
      {item.description && <p className="rdt-style-desc">{item.description}</p>}
      {(item.representative_brands as string[] | undefined)?.length && (
        <div className="rdt-tags" style={{ marginTop: 6 }}>
          {(item.representative_brands as string[]).slice(0, 4).map((b, i) => (
            <span key={i} className="rdt-tag">{b}</span>
          ))}
        </div>
      )}
      {tips && tips.length > 0 && (
        <ul className="rdt-style-tips">
          {tips.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── Dimension row ─────────────────────────────────────────

function DimRow({ label, items, colorSwatch }: { label: string; items?: string[]; colorSwatch?: boolean }) {
  if (!items?.length) return null;
  return (
    <div className="rdt-dim-row">
      <span className="rdt-dim-label">{label}</span>
      <div className="rdt-dim-tags">
        {items.slice(0, 12).map((t, i) => (
          <span key={i} className="rdt-tag">
            {colorSwatch && <ColorDot name={t} />}
            {t}
          </span>
        ))}
        {items.length > 12 && <span className="rdt-tag rdt-tag--more">+{items.length - 12}</span>}
      </div>
    </div>
  );
}

// ── Source articles ───────────────────────────────────────

function SourceArticles({
  keys,
  details,
}: {
  keys?: string[];
  details?: SourceArticleDetail[];
}) {
  if (!keys?.length) return null;

  const detailMap = Object.fromEntries(
    (details ?? []).map(d => [d.unique_key, d])
  );

  const rows = keys.map(k => detailMap[k] ?? { unique_key: k, title: k });

  return (
    <div className="rdt-section">
      <h3 className="rdt-section-title">
        来源文章 <span className="rdt-count">{rows.length}</span>
      </h3>
      <p className="rdt-sources-hint">分析所依据的抓取文章</p>
      <div className="rdt-source-list">
        {rows.slice(0, 12).map((row, i) => {
          const r = row as SourceArticleDetail;
          const url = String(r.article_url ?? '');
          const hasUrl = url.startsWith('http');
          return (
            <div key={i} className="rdt-source-row">
              <div className="rdt-source-main">
                <span className="rdt-source-title">{String(r.title ?? r.unique_key ?? '—')}</span>
                <div className="rdt-source-meta">
                  {r.site_name && <span className="rdt-source-site">{String(r.site_name)}</span>}
                  {hasUrl && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="rdt-source-link"
                    >
                      原文 <ExternalLink size={10} strokeWidth={1.5} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {rows.length > 12 && (
          <div className="rdt-source-more">…共 {rows.length} 篇</div>
        )}
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────

function Section({ title, count, children }: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rdt-section">
      <h3 className="rdt-section-title">
        {title}
        {count != null && count > 0 && <span className="rdt-count">{count}</span>}
      </h3>
      {children}
    </div>
  );
}

// ── Main component ────────────────────────────────────────

interface TrendReportDetailProps {
  reportId?: string;
  showLegacy: boolean;
  onToggleLegacy: () => void;
  legacyIframeSrc: string;
}

export default function TrendReportDetail({
  reportId,
  showLegacy,
  onToggleLegacy,
  legacyIframeSrc,
}: TrendReportDetailProps) {
  const abortRef = useRef<AbortController | null>(null);
  const [detail, setDetail]   = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!reportId) { setDetail(null); setLoading(false); setError(null); return; }

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);
    setDetail(null);

    fetchReportDetail(reportId, ctrl.signal)
      .then(d => { if (!ctrl.signal.aborted) { setDetail(d); setLoading(false); } })
      .catch(e => {
        if (!ctrl.signal.aborted) {
          setError(e instanceof Error ? e.message : '加载失败');
          setLoading(false);
        }
      });

    return () => ctrl.abort();
  }, [reportId]);

  if (!reportId) {
    return (
      <div className="rdt-shell rdt-shell--empty">
        <div className="rdt-empty">
          <FileText size={28} strokeWidth={1} style={{ color: 'var(--color-ink-3)' }} />
          <p className="rdt-empty-title">选择一份报告查看详情</p>
          <p className="rdt-empty-hint">点击左侧列表中的报告条目</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rdt-shell rdt-shell--loading">
        <div className="rdt-empty">
          <RefreshCw size={20} strokeWidth={1.5} className="animate-spin" style={{ color: 'var(--color-ink-3)' }} />
          <p className="rdt-empty-hint">加载报告中…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rdt-shell rdt-shell--error">
        <div className="rdt-empty">
          <AlertCircle size={22} strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
          <p className="rdt-empty-title">加载失败</p>
          <p className="rdt-empty-hint">{error}</p>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const trends     = detail.key_trends ?? [];
  const sourceKeys = detail.source_articles ?? [];
  const hasDims    = !!(
    detail.colors?.length || detail.fabrics?.length ||
    detail.style_keywords?.length || detail.silhouettes?.length ||
    detail.items?.length || detail.patterns?.length
  );
  const overallConf = typeof detail.confidence === 'number' ? detail.confidence : null;
  const summaryText = detail.summary ?? '';
  const copyText = summaryText || trends.map(t => trendName(t)).join(', ');
  const canShowLegacy = shouldShowLegacyTrendFrame();

  return (
    <div className="rdt-shell">

      {/* ── Header ── */}
      <div className="rdt-header">
        <div className="rdt-header-main">
          <div className="rdt-header-top">
            {detail.season_label_zh && (
              <span className="rdt-season-badge">{detail.season_label_zh}</span>
            )}
            {detail.partial && <span className="rdt-badge rdt-badge--partial">部分数据</span>}
            {detail.llm_model && (
              <span className="rdt-llm-badge" title="生成模型">{String(detail.llm_model)}</span>
            )}
          </div>

          <p className="rdt-header-summary">{summaryText || '(无摘要)'}</p>

          <div className="rdt-header-meta">
            {detail.report_date && <span>{detail.report_date}</span>}
            {detail.time_range && <span>{detail.time_range}</span>}
            {detail.generated_at && <span>生成 {fmtDate(detail.generated_at)}</span>}
            {trends.length > 0 && <span>{trends.length} 条趋势</span>}
            {sourceKeys.length > 0 && <span>{sourceKeys.length} 篇来源</span>}
            {overallConf !== null && (
              <span className="rdt-header-conf" title="整体置信度">
                置信度 {Math.round(overallConf * 100)}%
              </span>
            )}
          </div>

          {detail.covered_sites && detail.covered_sites.length > 0 && (
            <div className="rdt-sites">
              {detail.covered_sites.map((s, i) => (
                <span key={i} className="rdt-site-tag">{s}</span>
              ))}
            </div>
          )}
        </div>

        <div className="rdt-header-actions">
          {copyText && <CopyButton text={copyText} label="复制摘要" />}
          {canShowLegacy && (
            <button
              type="button"
              onClick={onToggleLegacy}
              className="rdt-legacy-btn"
              title="旧版详情预览 (Debug)"
            >
              <Monitor size={12} strokeWidth={1.5} />
              {showLegacy ? '收起预览' : 'Legacy Preview'}
            </button>
          )}
          <a
            href={`http://localhost:8002/api/reports/${encodeURIComponent(detail.report_id)}/export?format=html`}
            target="_blank"
            rel="noreferrer"
            className="rdt-export-btn"
            title="导出 HTML（可打印 PDF）"
          >
            <ExternalLink size={11} strokeWidth={1.5} /> 导出
          </a>
        </div>
      </div>

      {/* Notice */}
      {detail.body_notice_zh && (
        <div className="rdt-notice" role="status">{String(detail.body_notice_zh)}</div>
      )}

      {/* ── Body ── */}
      <div className="rdt-body">

        {/* Moodboard */}
        {(detail.representative_images?.length ?? 0) > 0 && (
          <Section title="趋势视觉板 · Moodboard">
            <ImageGrid urls={detail.representative_images} max={8} />
          </Section>
        )}

        {/* Dimensions */}
        {hasDims && (
          <Section title="维度概览">
            <div className="rdt-dims">
              <DimRow label="色彩" items={detail.colors} colorSwatch />
              <DimRow label="面料" items={detail.fabrics} />
              <DimRow label="风格" items={detail.style_keywords} />
              <DimRow label="廓形" items={detail.silhouettes} />
              <DimRow label="单品" items={detail.items} />
              <DimRow label="图案" items={detail.patterns} />
            </div>
          </Section>
        )}

        {/* Consumer signals */}
        {(detail.consumer_signals?.length ?? 0) > 0 && (
          <Section title="消费信号">
            <div className="rdt-dims">
              <div className="rdt-dim-tags">
                {detail.consumer_signals!.map((t, i) => (
                  <span key={i} className="rdt-tag">{t}</span>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* Key trends */}
        {trends.length > 0 && (
          <Section title="关键趋势" count={trends.length}>
            <div className="rdt-trends">
              {trends.map((t, i) => <TrendCard key={i} trend={t} index={i} />)}
            </div>
          </Section>
        )}

        {/* Style / item / silhouette / color detail sections */}
        {(detail.style_details?.length ?? 0) > 0 && (
          <Section title="款式板块" count={detail.style_details!.length}>
            <div className="rdt-style-grid">
              {detail.style_details!.map((s, i) => <StyleCard key={i} item={s} />)}
            </div>
          </Section>
        )}
        {(detail.item_details?.length ?? 0) > 0 && (
          <Section title="单品板块" count={detail.item_details!.length}>
            <div className="rdt-style-grid">
              {detail.item_details!.map((s, i) => <StyleCard key={i} item={s} />)}
            </div>
          </Section>
        )}
        {(detail.silhouette_details?.length ?? 0) > 0 && (
          <Section title="版型板块" count={detail.silhouette_details!.length}>
            <div className="rdt-style-grid">
              {detail.silhouette_details!.map((s, i) => <StyleCard key={i} item={s} />)}
            </div>
          </Section>
        )}
        {(detail.color_details?.length ?? 0) > 0 && (
          <Section title="颜色板块" count={detail.color_details!.length}>
            <div className="rdt-style-grid">
              {detail.color_details!.map((s, i) => <StyleCard key={i} item={s} />)}
            </div>
          </Section>
        )}

        {/* Source articles */}
        <SourceArticles keys={sourceKeys} details={detail.source_article_details} />

        {/* Empty state */}
        {!hasDims && trends.length === 0 &&
          !(detail.style_details?.length) &&
          !(detail.item_details?.length) &&
          !(detail.silhouette_details?.length) &&
          !(detail.color_details?.length) && (
          <div className="rdt-empty rdt-empty--inline">
            <FileText size={18} strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
            <p className="rdt-empty-hint">报告结构化内容为空{canShowLegacy ? '，可尝试 Legacy Preview 查看原始渲染' : ''}。</p>
          </div>
        )}

        {/* Footer */}
        <div className="rdt-footer">
          ID: {detail.report_id}
          {detail.llm_model && ` · ${String(detail.llm_model)}`}
          {detail.generated_at && ` · 生成于 ${fmtDate(detail.generated_at)}`}
        </div>
      </div>

      {/* Legacy iframe */}
      {canShowLegacy && showLegacy && (
        <div className="rdt-legacy-section">
          <div className="rdt-legacy-bar">
            <span className="rdt-legacy-label">Legacy View</span>
            <button type="button" onClick={onToggleLegacy} className="rdt-legacy-close">
              收起
            </button>
          </div>
          <iframe
            src={legacyIframeSrc}
            className="rdt-legacy-iframe"
            title="趋势报告 (旧版)"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          />
        </div>
      )}
    </div>
  );
}
