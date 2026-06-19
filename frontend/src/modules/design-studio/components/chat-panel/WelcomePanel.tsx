import { Loader2, RefreshCw } from 'lucide-react';
import { CAPABILITIES } from '../../utils/capabilities';
import { TREND_DIM_LABELS, TREND_DIM_ORDER, WELCOME_ICON_MAP } from './utils';
import type { TrendHotBlock, TrendHotStatus } from './types';

interface WelcomePanelProps {
  onSuggest: (prompt: string) => void;
  onApplyHotTag: (word: string) => void;
  onCategoryChange: (cat: string) => void;
  onReloadHot: () => void;
  trendHotCategory: string;
  trendHotStatus: TrendHotStatus;
  trendHotDisplayBlocks: TrendHotBlock[];
}

export function WelcomePanel({
  onSuggest,
  onApplyHotTag,
  onCategoryChange,
  onReloadHot,
  trendHotCategory,
  trendHotStatus,
  trendHotDisplayBlocks,
}: WelcomePanelProps) {
  return (
    <div className="fade-up-in">
      <div style={{ marginTop: 8, marginBottom: 28 }}>
        <p className="kicker">Atelier Studio &middot; Capabilities</p>
        <h2 className="headline headline-md" style={{ marginTop: 10 }}>
          你好，设计师
        </h2>
        <p className="dek" style={{ marginTop: 8, color: 'var(--color-ink-3)' }}>
          任选一个能力开始 — 无需按顺序。
        </p>
      </div>

      <div className="grid grid-cols-2" style={{ gap: 1, background: 'var(--color-border)' }}>
        {CAPABILITIES.map((cap, idx) => (
          <button
            key={cap.id}
            type="button"
            onClick={() => onSuggest(cap.promptTemplate)}
            className="welcome-cap"
          >
            <span className="welcome-cap-numeral">{String(idx + 1).padStart(2, '0')}</span>
            <span className="welcome-cap-icon">{WELCOME_ICON_MAP[cap.id]}</span>
            <p className="welcome-cap-title">{cap.title}</p>
            <p className="welcome-cap-sub">{cap.subtitle}</p>
          </button>
        ))}
      </div>

      <div className="welcome-trend">
        <div className="welcome-trend-head">
          <div>
            <p className="kicker">Trend Pulse</p>
            <p className="serif" style={{ fontSize: 17, fontWeight: 'var(--weight-light)', color: 'var(--color-ink)', marginTop: 2 }}>
              趋势分析
            </p>
            <p style={{ fontSize: 11, color: 'var(--color-ink-3)', marginTop: 4, fontFamily: 'var(--font-ui)', letterSpacing: '0.02em' }}>
              按维度热词 · 选分类后刷新列表 · 点击填入提示词
            </p>
          </div>
          <button
            type="button"
            onClick={onReloadHot}
            disabled={trendHotStatus === 'loading'}
            className="btn-ghost"
            style={{ height: 30, minHeight: 30, padding: '0 10px', fontSize: 11 }}
            title="重新拉取热词"
          >
            <RefreshCw className={`w-3 h-3 ${trendHotStatus === 'loading' ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            刷新
          </button>
        </div>
        <hr className="rule-thin" />
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="trend-hot-cat-welcome"
              className="kicker"
              style={{ fontSize: 10, letterSpacing: '0.22em' }}
            >
              维度
            </label>
            <select
              id="trend-hot-cat-welcome"
              value={trendHotCategory}
              onChange={e => onCategoryChange(e.target.value)}
              disabled={trendHotStatus === 'loading'}
              className="input-shell"
              style={{ minHeight: 28, height: 28, padding: '0 10px', fontSize: 11, minWidth: 120, maxWidth: '100%' }}
            >
              <option value="">全部维度</option>
              {TREND_DIM_ORDER.map(k => (
                <option key={k} value={k}>
                  {TREND_DIM_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          {trendHotStatus === 'loading' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--color-ink-3)' }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" strokeWidth={1.5} />
              正在同步热词…
            </div>
          )}
          {trendHotStatus === 'error' && (
            <p style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--color-ink-3)' }}>
              无法连接趋势服务。请确认趋势分析后端（端口 8002）已启动，稍后点击「刷新」。
            </p>
          )}
          {trendHotStatus === 'empty' && (
            <p style={{ fontSize: 11, color: 'var(--color-ink-3)' }}>暂无热词数据，可在趋势分析中心完成采集后再试。</p>
          )}
          {trendHotDisplayBlocks.length > 0 && (
            <div className="welcome-trend-scroll">
              {trendHotDisplayBlocks.map(block => (
                <div key={block.key}>
                  {!trendHotCategory && (
                    <p className="kicker" style={{ fontSize: 10, letterSpacing: '0.22em', marginBottom: 6 }}>
                      {block.label}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {block.items.map(it => (
                      <button
                        key={`${it.category}-${it.keyword}`}
                        type="button"
                        onClick={() => onApplyHotTag(it.keyword)}
                        className="trend-tag"
                        title={
                          it.count > 0
                            ? `${it.keyword} · ${it.categoryLabel} · ${it.count} 次`
                            : `${it.keyword} · ${it.categoryLabel}`
                        }
                      >
                        {it.keyword}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
