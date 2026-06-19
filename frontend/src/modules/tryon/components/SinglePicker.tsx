import { useEffect, useState } from 'react';
import { fetchTryOnPresets } from '../../../api/profileApi';
import type { TryOnPreset, TryOnPresetCategory, PresetRef } from '../../../types/profile';
import PresetCard from './PresetCard';

interface SinglePickerProps {
  authToken: string;
  category: TryOnPresetCategory;
  selected: PresetRef | null;
  onSelect: (ref: PresetRef | null) => void;
  /** sub-tabs by gender */
  genderTabs?: boolean;
  emptyHint: string;
}

export default function SinglePicker({
  authToken,
  category,
  selected,
  onSelect,
  genderTabs,
  emptyHint,
}: SinglePickerProps) {
  const [gender, setGender] = useState<'female' | 'male' | ''>(genderTabs ? 'female' : '');
  const [items, setItems] = useState<TryOnPreset[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetchTryOnPresets(authToken, category, gender ? { gender } : {});
        if (!cancelled) setItems(res.items);
      } catch (e) {
        console.warn(`[SinglePicker:${category}] load failed`, e);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken, category, gender]);

  return (
    <div className="flex h-full flex-col">
      {genderTabs && (
        <div className="flex shrink-0 items-center gap-1 px-3 py-2">
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
          <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>
            单选 · 再次点击取消
          </span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-3 pb-2 pt-1">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
            加载中...
          </div>
        ) : !items.length ? (
          <div className="flex h-24 items-center justify-center text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {emptyHint}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map(item => {
              const isSel = selected?.id === item.id;
              return (
                <PresetCard
                  key={item.id}
                  imageUrl={item.image_url}
                  name={item.name}
                  selected={isSel}
                  onClick={() => {
                    if (isSel) {
                      onSelect(null);
                    } else {
                      onSelect({
                        kind: 'preset',
                        id: item.id,
                        image_url: item.image_url,
                        name: item.name,
                        prompt: item.prompt || '',
                        group: category,
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
