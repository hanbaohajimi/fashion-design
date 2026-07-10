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
    <section
      className="canvas-bottom-panel-body trend-pulse-panel"
      aria-label="趋势脉冲"
    >
        <div className="trend-pulse-head">
          <div>
            <p className="kicker" style={{ fontSize: 10, letterSpacing: '0.24em' }}>Trend Pulse</p>
            <p className="trend-pulse-subtitle">实时趋势信号 · 点击标签写入设计提示</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="trend-hot-cat-inline" className="sr-only">热词维度</label>
        <select
          id="trend-hot-cat-inline"
          value={trendHotCategory}
          onChange={e => onCategoryChange(e.target.value)}
          disabled={trendHotStatus === 'loading'}
          className="trend-pulse-select"
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
        </div>
      {trendHotDisplayBlocks.length > 0 ? (
        <div className="trend-pulse-scroll">
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
        <p className="trend-pulse-empty">
          热词未加载，启动趋势服务后点「刷新」
        </p>
      ) : trendHotStatus === 'empty' ? (
        <p className="trend-pulse-empty">
          暂无热词
        </p>
      ) : null}
    </section>
  );
}
