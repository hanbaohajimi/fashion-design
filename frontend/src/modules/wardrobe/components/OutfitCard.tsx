import { Palette, X } from 'lucide-react';
import type { Outfit } from '../../../types/profile';

interface Props {
  outfit: Outfit;
  onDelete: () => void;
}

export default function OutfitCard({ outfit, onDelete }: Props) {
  const items = outfit.items || [];
  const cols = Math.min(items.length || 1, 4);
  return (
    <div className="outfit-card">
      <div
        className="outfit-card-img"
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {items.slice(0, 4).map(it => (
          <img key={it.id} src={it.thumbnail_url || it.image_url} alt="" />
        ))}
        {items.length === 0 && (
          <div className="outfit-card-empty">
            <Palette className="w-8 h-8" strokeWidth={1.2} />
          </div>
        )}
      </div>
      <div className="outfit-card-body">
        <div>
          <p className="outfit-card-name">{outfit.name || '未命名穿搭'}</p>
          <p className="outfit-card-meta">
            {items.length} pieces{outfit.occasion ? ` · ${outfit.occasion}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="outfit-card-x"
          title="删除"
          aria-label="删除穿搭"
        >
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
