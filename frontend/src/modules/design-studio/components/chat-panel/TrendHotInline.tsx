import { Loader2, RefreshCw } from 'lucide-react';
import { TREND_DIM_LABELS, TREND_DIM_ORDER } from './utils';
import type { TrendHotBlock, TrendHotStatus } from './types';

interface TrendHotInlineProps {
  trendHotCategory: string;
  trendHotStatus: TrendHotStatus;
  trendHotDisplayBlocks: TrendHotBlock[];
  onCategoryChange: (cat: string) => void;
  onReloadHot: () => void;
  onApplyHotTag: (word: string) => void;
}

export function TrendHotInline({
  trendHotCategory,
  trendHotStatus,
  trendHotDisplayBlocks,
  onCategoryChange,
  onReloadHot,
  onApplyHotTag,
}: TrendHotInlineProps) {
  return (
    <div
      className="shrink-0"
      style={{
        padding: '10px 16px 8px',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1.5" style={{ minHeight: 22 }}>
        <span className="kicker" style={{ fontSize: 10, letterSpacing: '0.22em' }}>
          Trend Pulse
        </span>
        <label htmlFor="trend-hot-cat-inline" className="sr-only">热词维度</label>
        <select
          id="trend-hot-cat-inline"
          value={trendHotCategory}
          onChange={e => onCategoryChange(e.target.value)}
          disabled={trendHotStatus === 'loading'}
          style={{
            fontSize: 10,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            color: 'var(--color-ink-2)',
            padding: '2px 6px',
            maxWidth: 140,
            fontFamily: 'var(--font-ui)',
            letterSpacing: '0.04em',
          }}
        >
          <option value="">全部</option>
          {TREND_DIM_ORDER.map(k => (
            <option key={k} value={k}>{TREND_DIM_LABELS[k]}</option>
          ))}
        </select>
        {trendHotStatus === 'loading' && (
          <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--color-ink-3)' }} strokeWidth={1.5} />
        )}
        <button
          type="button"
          onClick={onReloadHot}
          disabled={trendHotStatus === 'loading'}
          className="btn-ghost"
          style={{
            marginLeft: 'auto',
            height: 24,
            minHeight: 24,
            padding: '0 8px',
            fontSize: 10,
            letterSpacing: '0.06em',
          }}
          title="刷新热词"
        >
          <RefreshCw className={`w-3 h-3 ${trendHotStatus === 'loading' ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          刷新
        </button>
      </div>
      {trendHotDisplayBlocks.length > 0 ? (
        <div
          style={{
            maxHeight: 112,
            overflowY: 'auto',
            paddingBottom: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {trendHotDisplayBlocks.map(block => (
            <div key={block.key}>
              {!trendHotCategory && (
                <p className="kicker" style={{ fontSize: 9, letterSpacing: '0.22em', marginBottom: 4 }}>
                  {block.label}
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                {block.items.map(it => (
                  <button
                    key={`${it.category}-${it.keyword}`}
                    type="button"
                    onClick={() => onApplyHotTag(it.keyword)}
                    className="trend-tag-sm"
                    title={
                      it.count > 0
                        ? `${it.keyword} · ${it.categoryLabel} · ${it.count}`
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
      ) : trendHotStatus === 'error' ? (
        <p style={{ paddingBottom: 4, fontSize: 10, color: 'var(--color-ink-3)' }}>
          热词未加载，启动趋势服务后点「刷新」
        </p>
      ) : trendHotStatus === 'empty' ? (
        <p style={{ paddingBottom: 4, fontSize: 10, color: 'var(--color-ink-3)' }}>
          暂无热词
        </p>
      ) : null}
    </div>
  );
}
