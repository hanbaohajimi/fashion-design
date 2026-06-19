import { Search, Upload, Plus, X } from 'lucide-react';
import type { WardrobeStats } from '../../../types/profile';

export type ViewTab = 'wardrobe' | 'outfits';

interface Props {
  viewTab: ViewTab;
  setViewTab: (t: ViewTab) => void;
  stats: WardrobeStats | null;
  search: string;
  setSearch: (v: string) => void;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  onUploadClick: () => void;
  onNewOutfit: () => void;
  sourceFilters: { key: string; label: string }[];
}

export default function WardrobeHeader({
  viewTab, setViewTab, stats,
  search, setSearch, sourceFilter, setSourceFilter,
  onUploadClick, onNewOutfit, sourceFilters,
}: Props) {
  const total = stats?.total ?? 0;

  return (
    <>
      <div className="wardrobe-header">
        <div className="wardrobe-header-row">
          <div>
            <div className="wardrobe-kicker">My Wardrobe · Issue No. 01</div>
            <div className="wardrobe-headline">
              <span className="wardrobe-headline-num">{total}</span>
              <span className="wardrobe-headline-unit">
                {viewTab === 'wardrobe' ? 'pieces in rotation' : 'curated looks'}
              </span>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <p className="wardrobe-sub">
            {viewTab === 'wardrobe'
              ? '一个属于你的私人衣橱目录。上传、整理、并让 AI 为每一件单品标注风格、面料与色彩。'
              : '把衣橱里的单品组合成命名穿搭，建立一个自己的造型档案。'}
          </p>
        </div>
        <div className="wardrobe-tabs">
          {(['wardrobe', 'outfits'] as ViewTab[]).map((tab, i) => (
            <button
              key={tab}
              type="button"
              onClick={() => setViewTab(tab)}
              className={`wardrobe-tab ${viewTab === tab ? 'active' : ''}`}
            >
              <span className="tab-numeral">{`0${i + 1}`}</span>
              {tab === 'wardrobe' ? 'The Closet' : 'The Looks'}
            </button>
          ))}
        </div>
      </div>

      <div className="wardrobe-controls">
        {viewTab === 'wardrobe' ? (
          <>
            <div className="wardrobe-search">
              <Search className="w-3.5 h-3.5" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)', flexShrink: 0 }} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索衣物名称、标签、备注…"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                  aria-label="清空搜索"
                >
                  <X className="w-3 h-3" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
                </button>
              )}
            </div>
            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              className="wardrobe-select"
            >
              {sourceFilters.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            <button type="button" onClick={onUploadClick} className="wardrobe-cta">
              <Upload className="w-3.5 h-3.5" strokeWidth={1.5} />
              上传衣物
            </button>
          </>
        ) : (
          <button type="button" onClick={onNewOutfit} className="wardrobe-cta" style={{ marginLeft: 'auto' }}>
            <Plus className="w-3.5 h-3.5" strokeWidth={1.5} />
            新建穿搭
          </button>
        )}
      </div>
    </>
  );
}
