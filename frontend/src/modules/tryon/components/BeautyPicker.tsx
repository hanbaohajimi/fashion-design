import { useEffect, useMemo, useState } from 'react';
import { fetchTryOnPresets } from '../../../api/profileApi';
import type { TryOnPreset, PresetRef } from '../../../types/profile';
import PresetCard from './PresetCard';

interface BeautyPickerProps {
  authToken: string;
  hairstyle: PresetRef | null;
  color: PresetRef | null;
  onSelect: (kind: 'hairstyle' | 'color', ref: PresetRef | null) => void;
}

type BeautyType = 'hairstyle' | 'color';

export default function BeautyPicker({ authToken, hairstyle, color, onSelect }: BeautyPickerProps) {
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [activeType, setActiveType] = useState<BeautyType>('hairstyle');
  const [items, setItems] = useState<TryOnPreset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchTryOnPresets(authToken, 'beauty', { gender, type: activeType });
        if (!cancelled) setItems(res.items);
      } catch (e) {
        console.warn('[BeautyPicker] load failed', e);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken, gender, activeType]);

  const currentSelected = activeType === 'hairstyle' ? hairstyle : color;

  const typeTabs: { key: BeautyType; label: string }[] = useMemo(
    () => [
      { key: 'hairstyle', label: '发型' },
      { key: 'color', label: '发色' },
    ],
    [],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <div className="flex items-center gap-1">
          {(['female', 'male'] as const).map(g => (
            <button
              key={g}
              type="button"
              onClick={() => setGender(g)}
              className="rounded-full px-2.5 py-1 text-[11px]"
              style={{
                background: gender === g ? 'var(--color-accent)' : 'transparent',
                color: gender === g ? 'var(--color-canvas)' : 'var(--text-secondary)',
                border: '1px solid',
                borderColor: gender === g ? 'var(--color-accent)' : 'var(--border-soft)',
              }}
            >
              {g === 'female' ? '女' : '男'}
            </button>
          ))}
        </div>
        <span style={{ width: 1, height: 16, background: 'var(--border-soft)' }} />
        <div className="flex items-center gap-1">
          {typeTabs.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveType(t.key)}
              className="rounded-full px-2.5 py-1 text-[11px]"
              style={{
                background: activeType === t.key ? 'var(--text-primary)' : 'transparent',
                color: activeType === t.key ? 'var(--color-canvas)' : 'var(--text-secondary)',
                border: '1px solid',
                borderColor: activeType === t.key ? 'var(--text-primary)' : 'var(--border-soft)',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>
          发型 · 颜色（各一）
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
            加载中...
          </div>
        ) : !items.length ? (
          <div className="flex h-24 items-center justify-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
            暂无{activeType === 'hairstyle' ? '发型' : '发色'}预设，请在 services/design/presets/beauty/ 添加
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map(item => {
              const isSel = currentSelected?.id === item.id;
              return (
                <PresetCard
                  key={item.id}
                  imageUrl={item.image_url}
                  name={item.name}
                  selected={isSel}
                  onClick={() => {
                    if (isSel) {
                      onSelect(activeType, null);
                    } else {
                      onSelect(activeType, {
                        kind: 'preset',
                        id: item.id,
                        image_url: item.image_url,
                        name: item.name,
                        prompt: item.prompt || '',
                        group: 'beauty',
                      });
                    }
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
