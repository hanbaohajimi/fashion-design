import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fetchWardrobeItems, fetchTryOnPresets } from '../../../api/profileApi';
import type { TryOnPreset, WardrobeItem, TryOnClothing, WardrobeCategory } from '../../../types/profile';
import PresetCard from './PresetCard';

interface ClothesPickerProps {
  authToken: string;
  selected: TryOnClothing[];
  onToggle: (item: TryOnClothing) => void;
}

type SourceTab = 'all' | 'wardrobe' | 'preset';

const CATEGORY_FILTERS: { key: 'all' | WardrobeCategory; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'top', label: '上装' },
  { key: 'bottom', label: '下装' },
  { key: 'suit', label: '套装' },
  { key: 'shoes', label: '鞋子' },
  { key: 'bag', label: '包包' },
  { key: 'jewelry', label: '首饰' },
  { key: 'accessory', label: '配饰' },
  { key: 'uncategorized', label: '未分类' },
];

const SOURCE_COLORS: Record<string, string> = {
  trend: 'var(--color-ink)',
  design: 'var(--color-ink)',
  upload: 'var(--color-ink)',
  preset: 'var(--color-ink-3)',
  tryon: 'var(--color-ink)',
};

const SOURCE_TABS: { key: SourceTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'wardrobe', label: '我的衣橱' },
  { key: 'preset', label: '时尚趋势' },
];

export default function ClothesPicker({ authToken, selected, onToggle }: ClothesPickerProps) {
  const [sourceTab, setSourceTab] = useState<SourceTab>('all');
  const [catFilter, setCatFilter] = useState<'all' | WardrobeCategory>('all');
  const [wardrobeItems, setWardrobeItems] = useState<WardrobeItem[]>([]);
  const [presetItems, setPresetItems] = useState<TryOnPreset[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [w, p] = await Promise.all([
        fetchWardrobeItems(authToken, { limit: 200 }),
        fetchTryOnPresets(authToken, 'clothes'),
      ]);
      setWardrobeItems(w.items);
      setPresetItems(p.items);
    } catch (e) {
      console.warn('[ClothesPicker] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [w, p] = await Promise.all([
          fetchWardrobeItems(authToken, { limit: 200 }),
          fetchTryOnPresets(authToken, 'clothes'),
        ]);
        if (cancelled) return;
        setWardrobeItems(w.items);
        setPresetItems(p.items);
      } catch (e) {
        console.warn('[ClothesPicker] load failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  /** Map clothing key → index in selection order (used to show 图1/图2/文字). */
  const selectionIndex = useMemo(() => {
    const m = new Map<string, number>();
    selected.forEach((s, i) => m.set(`${s.kind}:${s.id}`, i));
    return m;
  }, [selected]);
  const selectedKeySet = useMemo(() => new Set(selectionIndex.keys()), [selectionIndex]);

  const overlayFor = (key: string): string | undefined => {
    const idx = selectionIndex.get(key);
    if (idx === undefined) return undefined;
    if (idx === 0) return '图 1';
    if (idx === 1) return '图 2';
    return '文字';
  };

  const wardrobeFiltered = useMemo(() => {
    if (sourceTab === 'preset') return [];
    if (catFilter === 'all') return wardrobeItems;
    return wardrobeItems.filter(it => it.category === catFilter);
  }, [wardrobeItems, sourceTab, catFilter]);

  const presetFiltered = useMemo(() => {
    if (sourceTab === 'wardrobe') return [];
    if (catFilter === 'all') return presetItems;
    return presetItems.filter(it => it.category === catFilter);
  }, [presetItems, sourceTab, catFilter]);

  const totalShown = wardrobeFiltered.length + presetFiltered.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-1">
          {SOURCE_TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSourceTab(t.key)}
              className="rounded-full px-2.5 py-1 text-[11px]"
              style={{
                background: sourceTab === t.key ? 'var(--color-accent)' : 'transparent',
                color: sourceTab === t.key ? 'var(--color-canvas)' : 'var(--text-secondary)',
                border: '1px solid',
                borderColor: sourceTab === t.key ? 'var(--color-accent)' : 'var(--border-soft)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span style={{ width: 1, height: 16, background: 'var(--border-soft)' }} />
        <div className="flex flex-wrap items-center gap-1">
          {CATEGORY_FILTERS.map(c => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCatFilter(c.key)}
              className="rounded-full px-2 py-0.5 text-[11px]"
              style={{
                background: catFilter === c.key ? 'var(--text-primary)' : 'transparent',
                color: catFilter === c.key ? 'var(--color-canvas)' : 'var(--text-secondary)',
                border: '1px solid',
                borderColor: catFilter === c.key ? 'var(--text-primary)' : 'var(--border-soft)',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>
          已选 {selected.length} · 显示 {totalShown}
        </span>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="rounded-full p-1.5 hover:bg-gray-100 disabled:opacity-50"
          title="重新拉取衣橱与系统预设"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
            加载中...
          </div>
        ) : totalShown === 0 ? (
          <div
            className="flex h-24 items-center justify-center text-[12px]"
            style={{ color: 'var(--text-muted)' }}
          >
            没有匹配的衣物。可在「我的衣橱」上传，或在 services/design/presets/clothes/ 添加系统预设。
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {wardrobeFiltered.map(item => {
              const key = `wardrobe:${item.id}`;
              const isSel = selectedKeySet.has(key);
              const badgeColor = SOURCE_COLORS[item.source_type] || 'var(--color-ink-3)';
              return (
                <PresetCard
                  key={`w-${item.id}`}
                  imageUrl={item.thumbnail_url || item.image_url}
                  name={item.name || '未命名'}
                  selected={isSel}
                  badge={{ text: item.source_label, color: badgeColor }}
                  cornerOverlay={overlayFor(key)}
                  onClick={() =>
                    onToggle({
                      kind: 'wardrobe',
                      id: item.id,
                      image_url: item.image_url,
                      name: item.name || '衣物',
                      source_label: item.source_label,
                    })
                  }
                />
              );
            })}
            {presetFiltered.map(item => {
              const key = `preset:${item.id}`;
              const isSel = selectedKeySet.has(key);
              return (
                <PresetCard
                  key={`p-${item.id}`}
                  imageUrl={item.image_url}
                  name={item.name}
                  selected={isSel}
                  badge={{ text: '时尚趋势', color: SOURCE_COLORS.preset }}
                  cornerOverlay={overlayFor(key)}
                  onClick={() =>
                    onToggle({
                      kind: 'preset',
                      id: item.id,
                      image_url: item.image_url,
                      name: item.name,
                      prompt: item.prompt,
                      group: 'clothes',
                    })
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
