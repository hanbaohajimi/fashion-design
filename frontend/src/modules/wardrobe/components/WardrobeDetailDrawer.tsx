import { useState, useEffect } from 'react';
import { X, Heart, RefreshCw } from 'lucide-react';
import { useToast } from '../../../components/Toast';
import { patchWardrobeItem } from '../../../api/profileApi';
import type { WardrobeItem, WardrobeCategory } from '../../../types/profile';

interface Props {
  item: WardrobeItem;
  authToken: string;
  categories: { key: string; label: string }[];
  onClose: () => void;
  onUpdate: (item: WardrobeItem) => void;
  onDelete: () => void;
}

export default function WardrobeDetailDrawer({
  item, authToken, categories, onClose, onUpdate, onDelete,
}: Props) {
  const { toast } = useToast();
  const [editName, setEditName] = useState(item.name);
  const [editNotes, setEditNotes] = useState(item.notes || '');
  const [editCategory, setEditCategory] = useState(item.category);
  const [retagging, setRetagging] = useState(false);

  useEffect(() => {
    setEditName(item.name);
    setEditNotes(item.notes || '');
    setEditCategory(item.category);
  }, [item]);

  const handleSave = async () => {
    try {
      const { item: updated } = await patchWardrobeItem(authToken, item.id, {
        name: editName,
        notes: editNotes || undefined,
        category: editCategory as WardrobeCategory,
      });
      onUpdate(updated);
      toast('已保存', 'success');
    } catch { toast('保存失败', 'error'); }
  };

  const handleToggleFavorite = async () => {
    try {
      const { item: updated } = await patchWardrobeItem(authToken, item.id, { favorite: !item.favorite });
      onUpdate(updated);
    } catch { toast('操作失败', 'error'); }
  };

  const handleRetag = async () => {
    try {
      setRetagging(true);
      const res = await fetch(`/api/design/wardrobe/items/${item.id}/re-analyze`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast('AI 重新识别中，稍后刷新查看结果', 'success');
    } catch {
      toast('重新识别请求失败', 'error');
    } finally {
      setRetagging(false);
    }
  };

  return (
    <>
      <div className="wardrobe-drawer-overlay" onClick={onClose} />
      <aside className="wardrobe-drawer" role="dialog" aria-label="衣物详情">
        <div className="wardrobe-drawer-header">
          <div>
            <div className="wardrobe-drawer-kicker">Wardrobe · Detail</div>
            <h2 className="wardrobe-drawer-title">{item.name || '未命名单品'}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="wardrobe-drawer-x"
            aria-label="关闭"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="wardrobe-drawer-body">
          <img className="wardrobe-drawer-img" src={item.image_url} alt={item.name} />

          <div className="wardrobe-drawer-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="wardrobe-drawer-tag">{item.source_label}</span>
              <button
                type="button"
                onClick={handleToggleFavorite}
                className={`item-card-fav ${item.favorite ? 'active' : ''}`}
                style={{ position: 'static', width: 32, height: 32, background: 'transparent', border: '1px solid var(--rule)' }}
                aria-label={item.favorite ? '取消收藏' : '收藏'}
              >
                <Heart className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>

            <div>
              <label className="wardrobe-field-label">名称 · Name</label>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="wardrobe-field-input"
              />
            </div>

            <div>
              <label className="wardrobe-field-label">分类 · Category</label>
              <select
                value={editCategory}
                onChange={e => setEditCategory(e.target.value as WardrobeCategory)}
                className="wardrobe-field-select"
              >
                {categories.filter(c => c.key !== 'all').map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>

            {item.ai_status === 'completed' && (
              <div>
                <p className="wardrobe-field-label">AI Tags · 识别标签</p>
                {item.confidence !== undefined && item.confidence < 0.7 && (
                  <p style={{ fontSize: 11, color: 'var(--color-ink-3)', marginBottom: 8, letterSpacing: '0.1em' }}>
                    置信度 {Math.round(item.confidence * 100)}% · 建议确认分类
                  </p>
                )}
                <div className="wardrobe-tag-cluster">
                  {item.style_tags?.map((t, i) => (
                    <span key={i} className="wardrobe-mini-tag">{t}</span>
                  ))}
                  {item.fabric && <span className="wardrobe-mini-tag">{item.fabric}</span>}
                  {item.season && <span className="wardrobe-mini-tag">{item.season}</span>}
                </div>
              </div>
            )}

            {item.ai_status === 'pending' && (
              <p className="wardrobe-pending-line">
                <RefreshCw className="w-3 h-3 animate-spin" strokeWidth={1.5} />
                AI · 识别中
              </p>
            )}

            {item.ai_status === 'failed' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <p style={{ fontSize: 11, color: 'var(--color-danger)', letterSpacing: '0.12em', opacity: 0.85 }}>
                  AI 分类失败
                </p>
                <button
                  type="button"
                  onClick={handleRetag}
                  disabled={retagging}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                    padding: '5px 10px', background: 'transparent',
                    border: '1px solid var(--color-border-medium)',
                    borderRadius: 4, cursor: retagging ? 'not-allowed' : 'pointer',
                    color: 'var(--color-ink-2)', opacity: retagging ? 0.5 : 1,
                  }}
                >
                  <RefreshCw className={`w-3 h-3 ${retagging ? 'animate-spin' : ''}`} strokeWidth={1.5} />
                  重新识别
                </button>
              </div>
            )}

            {item.colors?.length > 0 && (
              <div>
                <p className="wardrobe-field-label">Colors · 色彩</p>
                <div className="wardrobe-tag-cluster">
                  {item.colors.map((c, i) => (
                    <span key={i} className="wardrobe-mini-tag">{c}</span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="wardrobe-field-label">备注 · Notes</label>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                className="wardrobe-field-textarea"
              />
            </div>
          </div>
        </div>

        <div className="wardrobe-drawer-footer">
          <button type="button" onClick={handleSave} className="save-btn">保存</button>
          <button type="button" onClick={onDelete} className="delete-btn">删除</button>
        </div>
      </aside>
    </>
  );
}
