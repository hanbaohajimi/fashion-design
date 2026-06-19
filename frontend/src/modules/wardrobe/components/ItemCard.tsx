import { Heart } from 'lucide-react';
import type { WardrobeItem } from '../../../types/profile';

const CATEGORY_LABELS: Record<string, string> = {
  top: '上装', bottom: '下装', suit: '套装',
  shoes: '鞋子', bag: '包包', jewelry: '首饰',
  accessory: '配饰', uncategorized: '未分类',
};

interface Props {
  item: WardrobeItem;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onFavorite: () => void;
}

export default function ItemCard({ item, selecting, selected, onSelect, onFavorite }: Props) {
  return (
    <div
      onClick={onSelect}
      className={`item-card ${selected ? 'selected' : ''}`}
    >
      {selecting ? (
        <div className={`item-card-select ${selected ? 'checked' : ''}`}>
          {selected && '✓'}
        </div>
      ) : (
        <button
          type="button"
          className={`item-card-fav ${item.favorite ? 'active' : ''}`}
          onClick={e => { e.stopPropagation(); onFavorite(); }}
          aria-label={item.favorite ? '取消收藏' : '收藏'}
          title={item.favorite ? '取消收藏' : '收藏'}
        >
          <Heart className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
      )}

      <span className="item-card-tag">{item.source_label}</span>

      <div className="item-card-img">
        <img
          src={item.thumbnail_url || item.image_url}
          alt={item.name}
          loading="lazy"
        />
      </div>

      <div className="item-card-body">
        <p className="item-card-name">{item.name || '未命名'}</p>
        <p className="item-card-cat">
          {CATEGORY_LABELS[item.category] ?? item.category}
          {item.ai_status === 'completed' &&
            item.confidence !== undefined &&
            item.confidence < 0.7 && (
            <span className="item-card-confidence"> · {Math.round(item.confidence * 100)}%</span>
          )}
        </p>
        {item.ai_status === 'pending' && (
          <p className="item-card-pending">AI · 识别中</p>
        )}
        {item.ai_status === 'failed' && (
          <p className="item-card-failed">分类失败</p>
        )}
        {item.colors?.length > 0 && (
          <div className="item-card-colors">
            {item.colors.slice(0, 4).map((c, i) => (
              <span key={i} className="item-card-color">{c}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
