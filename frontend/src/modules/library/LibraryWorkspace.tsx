import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { Heart, Trash2, MoreHorizontal, Search, SlidersHorizontal, Plus, X, BookOpen, Star, Grid3X3, ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import type { LibraryItem, LibraryCollection, LibraryStats, OutfitSuggestion } from '../../types/profile';
import {
  fetchLibraryItems,
  fetchCollections,
  fetchLibraryStats,
  patchLibraryItem,
  deleteLibraryItem,
  createCollection,
  deleteCollection,
  addItemsToCollection,
  removeItemFromCollection,
  triggerLibraryAnalyze,
  suggestOutfit,
  fetchSimilarItems,
} from '../../api/profileApi';
import { useToast } from '../../components/Toast';

interface LibraryWorkspaceProps {
  user: { email: string; name: string; auth_token: string };
  onSwitchToDesignStudio?: (sessionId?: string) => void;
}

type Tab = 'all' | 'favorites' | 'collections';

// ── Item card ─────────────────────────────────────────────

function ItemCard({
  item,
  index,
  onFavorite,
  onDelete,
  onClick,
}: {
  item: LibraryItem;
  index: number;
  onFavorite: (id: string, val: boolean) => void;
  onDelete: (id: string) => void;
  onClick: (item: LibraryItem) => void;
}) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [favAnimating, setFavAnimating] = useState(false);
  const favTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (favTimerRef.current) clearTimeout(favTimerRef.current); }, []);

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFavAnimating(true);
    if (favTimerRef.current) clearTimeout(favTimerRef.current);
    favTimerRef.current = setTimeout(() => setFavAnimating(false), 400);
    onFavorite(item.id, !item.is_favorite);
  };

  return (
    <div
      className="group relative cursor-pointer overflow-hidden"
      style={{
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-surface)',
        animation: `cardEnter 300ms var(--ease-out) both`,
        animationDelay: `${Math.min(index * 40, 400)}ms`,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setMenuOpen(false); }}
      onClick={() => onClick(item)}
    >
      {/* Image */}
      <div style={{ overflow: 'hidden' }}>
        <img
          src={item.image_url}
          alt=""
          loading="lazy"
          className="w-full block"
          style={{
            aspectRatio: '3/4',
            objectFit: 'cover',
            transition: 'transform 400ms var(--ease-out)',
            transform: hover ? 'scale(1.04)' : 'scale(1)',
          }}
        />
      </div>

      {/* Hover overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(8,8,8,0.70) 0%, rgba(8,8,8,0.15) 50%, transparent 100%)',
          opacity: hover ? 1 : 0,
          transition: 'opacity 200ms',
          pointerEvents: hover ? 'auto' : 'none',
        }}
      >
        {/* Top-right actions */}
        <div
          className="absolute right-2 top-2 flex items-center gap-1"
          onClick={e => e.stopPropagation()}
        >
          {/* Fav button */}
          <button
            type="button"
            onClick={handleFav}
            style={{
              width: 32, height: 32,
              borderRadius: 'var(--radius-pill)',
              background: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(8px)',
              border: 'none',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: item.is_favorite ? 'var(--color-gold)' : 'var(--color-ink-3)',
              transform: favAnimating ? 'scale(1.4)' : 'scale(1)',
              transition: 'transform 400ms var(--ease-out), color 150ms',
            }}
          >
            <Heart
              size={14}
              fill={item.is_favorite ? 'currentColor' : 'none'}
            />
          </button>

          {/* More menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(m => !m)}
              style={{
                width: 32, height: 32,
                borderRadius: 'var(--radius-pill)',
                background: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(8px)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-ink-3)',
              }}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute',
                right: 0, top: '100%',
                zIndex: 20,
                marginTop: 4,
                width: 120,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface-2)',
                boxShadow: 'var(--shadow-lg)',
                padding: '4px',
              }}>
                <button
                  type="button"
                  onClick={() => { onDelete(item.id); setMenuOpen(false); }}
                  style={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    textAlign: 'left',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-danger)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)',
                    fontFamily: 'var(--font-ui)',
                    transition: 'background 150ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(168,88,88,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Trash2 size={11} /> 删除
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bottom info */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '8px 10px' }}>
          {/* Trend tags */}
          {item.auto_tags?.style_keywords?.length ? (
            <div className="flex flex-wrap gap-1 mb-1">
              {item.auto_tags.style_keywords.slice(0, 1).map(k => (
                <span key={k} className="tag-trend" style={{ fontSize: 9, height: 18 }}>
                  {k}
                </span>
              ))}
            </div>
          ) : null}
          {/* Continue */}
          <div style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-gold)',
            fontFamily: 'var(--font-ui)',
            textAlign: 'right',
          }}>
            继续创作 →
          </div>
        </div>
      </div>

      {/* Always-visible fav indicator */}
      {item.is_favorite && !hover && (
        <div style={{
          position: 'absolute',
          top: 8, right: 8,
          color: 'var(--color-gold)',
          filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))',
        }}>
          <Heart size={12} fill="currentColor" />
        </div>
      )}
    </div>
  );
}

const ItemCardMemo = memo(ItemCard);

// ── Collection card ────────────────────────────────────────

function CollectionCard({
  col,
  items,
  isSelected,
  onSelect,
  onDelete,
}: {
  col: LibraryCollection;
  items: LibraryItem[];
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  const coverItems = items.slice(0, 4);

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        cursor: 'pointer',
        border: isSelected
          ? '1px solid var(--color-gold)'
          : hover
          ? '1px solid var(--color-border)'
          : '1px solid var(--color-border-subtle)',
        background: 'var(--color-surface)',
        transition: 'border-color 150ms, box-shadow 150ms',
        boxShadow: isSelected ? 'var(--shadow-gold)' : hover ? 'var(--shadow-md)' : 'none',
      }}
    >
      {/* Cover */}
      <div style={{ height: 180, display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden' }}>
        {coverItems.length === 0 && (
          <div style={{
            gridColumn: '1 / -1',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--color-surface-2)',
            color: 'var(--color-ink-3)',
          }}>
            <Grid3X3 size={24} />
          </div>
        )}
        {coverItems.length === 1 && (
          <img
            src={coverItems[0].image_url} alt=""
            style={{ gridColumn: '1 / -1', width: '100%', height: '100%', objectFit: 'cover',
              transform: hover ? 'scale(1.03)' : 'scale(1)', transition: 'transform 400ms var(--ease-out)' }}
          />
        )}
        {coverItems.length >= 2 && (
          <>
            <img src={coverItems[0].image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover',
              transform: hover ? 'scale(1.03)' : 'scale(1)', transition: 'transform 400ms var(--ease-out)' }} />
            <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr' }}>
              {coverItems.slice(1, 3).map((ci, i) => (
                <img key={i} src={ci.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover',
                  transform: hover ? 'scale(1.03)' : 'scale(1)', transition: 'transform 400ms var(--ease-out)' }} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: 'var(--space-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 'var(--text-base)', fontWeight: 'var(--weight-medium)',
            color: 'var(--color-ink)', fontFamily: 'var(--font-ui)',
          }}>
            {col.is_smart && <Sparkles size={12} style={{ color: 'var(--color-gold)' }} />}
            {col.name}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', marginTop: 2, fontFamily: 'var(--font-ui)' }}>
            {col.item_count} 张图片
          </div>
          {col.is_smart && (
            <span className="tag-ai" style={{ marginTop: 4 }}>🤖 自动生成</span>
          )}
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="btn-icon"
          style={{ opacity: hover ? 1 : 0, transition: 'opacity 150ms', color: 'var(--color-danger)' }}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}

// ── New collection card ────────────────────────────────────

function NewCollectionCard({
  name,
  onChange,
  onCreate,
  creating,
}: {
  name: string;
  onChange: (v: string) => void;
  onCreate: () => void;
  creating: boolean;
}) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 'var(--radius-lg)',
        border: hover ? '1px dashed var(--color-gold)' : '1px dashed var(--color-border)',
        background: 'var(--color-surface)',
        minHeight: 240,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-6)',
        transition: 'border-color 150ms',
        cursor: 'pointer',
      }}
    >
      <div style={{
        width: 40, height: 40,
        borderRadius: 'var(--radius-pill)',
        border: hover ? '1px solid var(--color-gold)' : '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: hover ? 'var(--color-gold)' : 'var(--color-ink-3)',
        transition: 'all 150ms',
      }}>
        <Plus size={18} />
      </div>
      <div style={{
        fontSize: 'var(--text-sm)', color: hover ? 'var(--color-gold)' : 'var(--color-ink-3)',
        fontFamily: 'var(--font-ui)', transition: 'color 150ms',
      }}>
        新建合集
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', width: '100%' }} onClick={e => e.stopPropagation()}>
        <input
          type="text"
          value={name}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onCreate(); }}
          placeholder="合集名称..."
          className="input"
          style={{ flex: 1, fontSize: 'var(--text-sm)' }}
        />
        <button
          type="button"
          onClick={onCreate}
          disabled={creating || !name.trim()}
          className="btn-primary"
          style={{ padding: '0 var(--space-4)', height: 40 }}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Detail sidebar ─────────────────────────────────────────

function DetailSidebar({
  item,
  authToken,
  collections,
  onUpdate,
  onClose,
  onContinueInStudio,
}: {
  item: LibraryItem;
  authToken: string;
  collections: LibraryCollection[];
  onUpdate: (updated: LibraryItem) => void;
  onClose: () => void;
  onContinueInStudio: (item: LibraryItem) => void;
}) {
  const { toast } = useToast();
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState(item.notes || '');
  const [notesChanged, setNotesChanged] = useState(false);
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [similar, setSimilar] = useState<LibraryItem[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [versionChain, setVersionChain] = useState<LibraryItem[]>([]);

  useEffect(() => {
    setNotes(item.notes || '');
    setNotesChanged(false);
  }, [item.id]);

  const loadSimilar = async () => {
    setLoadingSimilar(true);
    try {
      const r = await fetchSimilarItems(authToken, item.id);
      setSimilar(r.items);
    } catch { /* ignore */ }
    setLoadingSimilar(false);
  };

  const handleFavorite = async () => {
    try {
      const r = await patchLibraryItem(authToken, item.id, { is_favorite: !item.is_favorite });
      onUpdate(r.item);
    } catch { toast('操作失败', 'error'); }
  };

  const handleAddTag = async () => {
    if (!tagInput.trim()) return;
    const newTags = [...item.user_tags, tagInput.trim()];
    try {
      const r = await patchLibraryItem(authToken, item.id, { user_tags: newTags });
      onUpdate(r.item);
      setTagInput('');
    } catch { toast('添加失败', 'error'); }
  };

  const handleRemoveTag = async (tag: string) => {
    const newTags = item.user_tags.filter(t => t !== tag);
    try {
      const r = await patchLibraryItem(authToken, item.id, { user_tags: newTags });
      onUpdate(r.item);
    } catch { /* ignore */ }
  };

  const handleSaveNotes = async () => {
    try {
      const r = await patchLibraryItem(authToken, item.id, { notes });
      onUpdate(r.item);
      setNotesChanged(false);
      toast('备注已保存', 'success');
    } catch { toast('保存失败', 'error'); }
  };

  const handleAddToCollection = async (colId: string) => {
    try {
      await addItemsToCollection(authToken, colId, [item.id]);
      toast('已加入合集', 'success');
    } catch { toast('操作失败', 'error'); }
    setColMenuOpen(false);
  };

  const t = item.auto_tags;
  const allAutoTags = [
    ...(t?.garment_types || []),
    ...(t?.colors || []),
    t?.silhouette,
    ...(t?.occasions || []),
    ...(t?.style_keywords || []),
    t?.season,
  ].filter(Boolean) as string[];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: 320,
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        animation: 'drawerSlide var(--duration-slow) var(--ease-out)',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--color-border)',
        padding: 'var(--space-4)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>
          图片详情
        </span>
        <button type="button" onClick={onClose} className="btn-icon">
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Image */}
        <div style={{ background: 'var(--color-surface-3)', padding: 'var(--space-4)' }}>
          <img
            src={item.image_url} alt=""
            style={{ width: '100%', borderRadius: 'var(--radius-md)', objectFit: 'contain', maxHeight: 300 }}
          />
        </div>

        {/* Action bar */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--color-border-subtle)',
          padding: '0 var(--space-4)',
        }}>
          {[
            {
              icon: <Heart size={14} fill={item.is_favorite ? 'currentColor' : 'none'} />,
              label: item.is_favorite ? '已收藏' : '收藏',
              active: item.is_favorite,
              onClick: () => void handleFavorite(),
            },
            {
              icon: <BookOpen size={14} />,
              label: '合集',
              active: false,
              onClick: () => setColMenuOpen(m => !m),
            },
          ].map(btn => (
            <button
              key={btn.label}
              type="button"
              onClick={btn.onClick}
              style={{
                flex: 1,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 4,
                padding: 'var(--space-3) 0',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: btn.active ? 'var(--color-gold)' : 'var(--color-ink-3)',
                fontSize: 'var(--text-2xs)',
                fontFamily: 'var(--font-ui)',
                transition: 'color 150ms',
              }}
              onMouseEnter={e => !btn.active && (e.currentTarget.style.color = 'var(--color-ink-2)')}
              onMouseLeave={e => !btn.active && (e.currentTarget.style.color = 'var(--color-ink-3)')}
            >
              {btn.icon}
              {btn.label}
            </button>
          ))}

          {/* Collection dropdown */}
          {colMenuOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 'var(--space-4)',
              zIndex: 20,
              marginTop: 4,
              width: 180,
              maxHeight: 200,
              overflowY: 'auto',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface-2)',
              boxShadow: 'var(--shadow-lg)',
              padding: 4,
            }}>
              {collections.length === 0 && (
                <p style={{ padding: '8px 12px', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
                  暂无合集
                </p>
              )}
              {collections.map(col => (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => void handleAddToCollection(col.id)}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                    padding: '8px 12px', textAlign: 'left',
                    fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-ui)',
                    transition: 'background 150ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--overlay-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {col.is_smart && <Sparkles size={10} style={{ color: 'var(--color-gold)', flexShrink: 0 }} />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Auto tags */}
          {allAutoTags.length > 0 && (
            <div>
              <p className="subsection-title">风格标签</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {allAutoTags.map((tag, i) => (
                  <span key={i} className="tag">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* User tags */}
          <div>
            <p className="subsection-title">我的标签</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              {item.user_tags.map(tag => (
                <span
                  key={tag}
                  className="tag-user"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => void handleRemoveTag(tag)}
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: 'rgba(90,127,168,0.7)', padding: 0, lineHeight: 1,
                    }}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleAddTag(); }}
                placeholder="添加标签..."
                className="input"
                style={{ flex: 1, height: 32, fontSize: 'var(--text-xs)', minHeight: 32 }}
              />
              <button
                type="button"
                onClick={() => void handleAddTag()}
                className="btn-icon"
                style={{ width: 32, height: 32, background: 'var(--color-gold)', color: '#FFFFFF', borderRadius: 'var(--radius-md)' }}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="subsection-title">备注</p>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setNotesChanged(true); }}
              placeholder="添加备注..."
              rows={3}
              className="input"
              style={{ height: 'auto', resize: 'none', padding: 'var(--space-3) var(--space-4)', lineHeight: 'var(--leading-normal)' }}
            />
            {notesChanged && (
              <button
                type="button"
                onClick={() => void handleSaveNotes()}
                style={{
                  marginTop: 4, fontSize: 'var(--text-xs)', color: 'var(--color-gold)',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-ui)',
                }}
              >
                保存备注
              </button>
            )}
          </div>

          {/* Divider */}
          <div className="divider" style={{ margin: 0 }} />

          {/* Source */}
          <div>
            <p className="subsection-title">来源对话</p>
            <p style={{ marginBottom: 4, fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
              {new Date(item.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            {item.generation_prompt && (
              <p style={{
                marginBottom: 'var(--space-4)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-ink-2)',
                lineHeight: 'var(--leading-normal)',
                fontFamily: 'var(--font-ui)',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                "{item.generation_prompt}"
              </p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                type="button"
                onClick={() => onContinueInStudio(item)}
                className="btn-primary"
                style={{ flex: 1, fontSize: 'var(--text-xs)', height: 36 }}
              >
                <ChevronRight size={12} /> 继续迭代 →
              </button>
            </div>
          </div>

          {/* Similar */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <p className="subsection-title" style={{ marginBottom: 0 }}>相似图片</p>
              {!similar.length && (
                <button
                  type="button"
                  onClick={() => void loadSimilar()}
                  disabled={loadingSimilar}
                  className="btn-ghost"
                  style={{ height: 24, padding: '0 8px', fontSize: 'var(--text-xs)' }}
                >
                  {loadingSimilar ? <RefreshCw size={10} className="animate-spin" /> : '加载'}
                </button>
              )}
            </div>
            {similar.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {similar.slice(0, 6).map(s => (
                  <img
                    key={s.id}
                    src={s.image_url}
                    alt=""
                    style={{
                      aspectRatio: '1',
                      width: '100%',
                      objectFit: 'cover',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      transition: 'opacity 150ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Version chain ──────────────────────────────────────────

function VersionChain({ items }: { items: LibraryItem[] }) {
  if (items.length < 2) return null;
  return (
    <div style={{
      borderBottom: '1px solid var(--color-border-subtle)',
      background: 'var(--color-surface-2)',
      padding: 'var(--space-3) var(--space-4)',
    }}>
      <p className="subsection-title" style={{ marginBottom: 'var(--space-2)' }}>版本链</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {items.map((item, i) => (
          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div style={{ textAlign: 'center' }}>
              <img
                src={item.image_url} alt=""
                style={{
                  width: 56, height: 56,
                  borderRadius: 'var(--radius-md)',
                  objectFit: 'cover',
                  border: '1px solid var(--color-border)',
                }}
              />
              <p style={{ marginTop: 2, fontSize: 9, color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
                {new Date(item.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
              </p>
            </div>
            {i < items.length - 1 && (
              <ChevronRight size={12} style={{ color: 'var(--color-ink-3)', flexShrink: 0 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Outfit card ────────────────────────────────────────────

function OutfitCard({ outfit }: { outfit: OutfitSuggestion }) {
  return (
    <div style={{
      overflow: 'hidden',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
    }}>
      <div style={{ display: 'flex', gap: 8, padding: 12 }}>
        {outfit.items.slice(0, 3).map(item => (
          <img
            key={item.id}
            src={item.image_url} alt=""
            style={{ height: 80, width: 64, flexShrink: 0, borderRadius: 'var(--radius-md)', objectFit: 'cover' }}
          />
        ))}
      </div>
      <div style={{ padding: '0 12px 12px' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
          {outfit.description}
        </p>
        {outfit.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {outfit.tags.map(t => (
              <span key={t} className="tag">{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────

export default function LibraryWorkspace({ user, onSwitchToDesignStudio }: LibraryWorkspaceProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('all');
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [collections, setCollections] = useState<LibraryCollection[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [selectedColId, setSelectedColId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterMode, setFilterMode] = useState<string>('');
  const [filterOccasion, setFilterOccasion] = useState<string>('');
  const [filterSeason, setFilterSeason] = useState<string>('');

  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [newColName, setNewColName] = useState('');
  const [creatingCol, setCreatingCol] = useState(false);

  const [outfits, setOutfits] = useState<OutfitSuggestion[]>([]);
  const [outfitLoading, setOutfitLoading] = useState(false);
  const [outfitMessage, setOutfitMessage] = useState('');
  const [showOutfits, setShowOutfits] = useState(false);

  const [analyzingLib, setAnalyzingLib] = useState(false);

  const versionChain = useMemo(() => {
    if (!selectedItem?.session_id) return [];
    return items
      .filter(i => i.session_id === selectedItem.session_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [selectedItem?.session_id, items]);

  const loaderRef = useRef<HTMLDivElement>(null);

  const buildParams = useCallback((p: number) => {
    const params: Record<string, unknown> = { page: p, limit: 30 };
    if (tab === 'favorites') params.is_favorite = true;
    if (tab === 'collections' && selectedColId) params.collection_id = selectedColId;
    if (filterMode) params.mode = filterMode;
    const tagParts = [];
    if (filterOccasion) tagParts.push(filterOccasion);
    if (filterSeason) tagParts.push(filterSeason);
    if (searchQuery.trim()) tagParts.push(searchQuery.trim());
    if (tagParts.length) params.tags = tagParts.join(',');
    return params;
  }, [tab, selectedColId, filterMode, filterOccasion, filterSeason, searchQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setPage(1);
    try {
      const [itemsRes, colsRes, statsRes] = await Promise.all([
        fetchLibraryItems(user.auth_token, buildParams(1)),
        fetchCollections(user.auth_token),
        fetchLibraryStats(user.auth_token),
      ]);
      setItems(itemsRes.items);
      setTotal(itemsRes.total);
      setHasMore(itemsRes.has_more);
      setCollections(colsRes.collections);
      setStats(statsRes);
    } catch { toast('加载失败', 'error'); }
    setLoading(false);
  }, [user.auth_token, buildParams, toast]);

  useEffect(() => { void load(); }, [tab, selectedColId, filterMode, filterOccasion, filterSeason]);

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void load();
  };

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const res = await fetchLibraryItems(user.auth_token, buildParams(nextPage));
      setItems(prev => [...prev, ...res.items]);
      setPage(nextPage);
      setHasMore(res.has_more);
    } catch { /* ignore */ }
    setLoadingMore(false);
  }, [loadingMore, hasMore, page, user.auth_token, buildParams]);

  useEffect(() => {
    if (!loaderRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) void loadMore();
    }, { threshold: 0.1 });
    obs.observe(loaderRef.current);
    return () => obs.disconnect();
  }, [loadMore]);

  const handleFavorite = useCallback(async (id: string, val: boolean) => {
    try {
      const r = await patchLibraryItem(user.auth_token, id, { is_favorite: val });
      setItems(prev => prev.map(i => i.id === id ? r.item : i));
      if (selectedItem?.id === id) setSelectedItem(r.item);
    } catch { toast('操作失败', 'error'); }
  }, [user.auth_token, selectedItem?.id, toast]);

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm('确认删除此图片？')) return;
    try {
      await deleteLibraryItem(user.auth_token, id);
      setItems(prev => prev.filter(i => i.id !== id));
      if (selectedItem?.id === id) setSelectedItem(null);
      toast('已删除', 'success');
    } catch { toast('删除失败', 'error'); }
  }, [user.auth_token, selectedItem?.id, toast]);

  const handleItemUpdate = (updated: LibraryItem) => {
    setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    setSelectedItem(updated);
  };

  const handleCreateCollection = async () => {
    if (!newColName.trim()) return;
    setCreatingCol(true);
    try {
      const r = await createCollection(user.auth_token, newColName.trim());
      setCollections(prev => [...prev, r.collection]);
      setNewColName('');
      toast(`合集「${r.collection.name}」已创建`, 'success');
    } catch { toast('创建失败', 'error'); }
    setCreatingCol(false);
  };

  const handleDeleteCollection = async (colId: string) => {
    if (!window.confirm('确认删除此合集？')) return;
    try {
      await deleteCollection(user.auth_token, colId);
      setCollections(prev => prev.filter(c => c.id !== colId));
      if (selectedColId === colId) setSelectedColId(null);
      toast('合集已删除', 'success');
    } catch { toast('删除失败', 'error'); }
  };

  const handleSuggestOutfit = async () => {
    setOutfitLoading(true);
    setShowOutfits(true);
    try {
      const r = await suggestOutfit(user.auth_token);
      setOutfits(r.outfits);
      setOutfitMessage(r.message || '');
    } catch { toast('AI 搭配失败', 'error'); }
    setOutfitLoading(false);
  };

  const handleAnalyzeLib = async () => {
    setAnalyzingLib(true);
    try {
      await triggerLibraryAnalyze(user.auth_token);
      toast('风格档案已更新', 'success');
    } catch { toast('分析失败', 'error'); }
    setAnalyzingLib(false);
  };

  const handleContinueInStudio = (item: LibraryItem) => {
    onSwitchToDesignStudio?.(item.session_id);
    toast('已切换到设计工作台', 'info');
  };

  const groupedItems = useMemo(() => {
    const groups: Array<{ date: string; items: LibraryItem[] }> = [];
    for (const item of items) {
      const date = new Date(item.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      const last = groups[groups.length - 1];
      if (last && last.date === date) {
        last.items.push(item);
      } else {
        groups.push({ date, items: [item] });
      }
    }
    return groups;
  }, [items]);

  // Active filters count
  const activeFilters = [filterMode, filterOccasion, filterSeason].filter(Boolean).length;

  const TABS: [Tab, string][] = [['all', '全部'], ['favorites', '收藏'], ['collections', '合集']];

  const itemsWithSession = useMemo(() => items.filter(i => i.session_id), [items]);

  const handleFavoriteStable = useCallback((id: string, val: boolean) => void handleFavorite(id, val), [user.auth_token]);
  const handleDeleteStable = useCallback((id: string) => void handleDelete(id), [user.auth_token]);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--color-ground)' }}>
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>

        {/* Sticky toolbar */}
        <div style={{
          position: 'sticky', top: 0,
          zIndex: 'var(--z-raised)' as any,
          display: 'flex', flexShrink: 0, alignItems: 'center', gap: 'var(--space-3)',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-ground)',
          padding: '0 var(--space-6)',
          height: 52,
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
            {TABS.map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setSelectedColId(null); }}
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center',
                  padding: '0 var(--space-4)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-ui)',
                  fontWeight: tab === t ? 'var(--weight-medium)' : 'var(--weight-regular)',
                  color: tab === t ? 'var(--color-ink)' : 'var(--color-ink-3)',
                  transition: 'color 150ms',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
                {t === 'all' && total > 0 && (
                  <span style={{
                    marginLeft: 6,
                    fontSize: 'var(--text-2xs)',
                    color: tab === t ? 'var(--color-ink-3)' : 'var(--color-ink-3)',
                  }}>
                    {total}
                  </span>
                )}
                {/* Active underline */}
                {tab === t && (
                  <span style={{
                    position: 'absolute', bottom: 0, left: '20%', right: '20%',
                    height: 2, borderRadius: 'var(--radius-pill)',
                    background: 'var(--color-gold)',
                  }} />
                )}
              </button>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div style={{ position: 'relative', width: 180 }}>
            <Search size={13} style={{
              position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-ink-3)', pointerEvents: 'none',
            }} />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
              placeholder="搜索标签..."
              className="input"
              style={{ paddingLeft: 32, height: 34, minHeight: 34, fontSize: 'var(--text-xs)' }}
            />
          </div>

          {/* Filter */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setFilterOpen(o => !o)}
              className="btn-icon"
              style={{
                color: activeFilters > 0 ? 'var(--color-gold)' : 'var(--color-ink-3)',
                background: filterOpen ? 'var(--overlay-medium)' : 'transparent',
              }}
            >
              <SlidersHorizontal size={15} />
              {activeFilters > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 6, height: 6, borderRadius: '50%',
                  background: 'var(--color-gold)',
                }} />
              )}
            </button>

            {filterOpen && (
              <div
                className="dropdown-enter"
                style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 8px)',
                  zIndex: 20, width: 260,
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  boxShadow: 'var(--shadow-lg)',
                  padding: 'var(--space-4)',
                  display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
                }}
              >
                {[
                  {
                    title: '模式',
                    options: [['', '全部'], ['personal', '个人'], ['designer', '设计师']] as [string, string][],
                    current: filterMode,
                    set: setFilterMode,
                  },
                  {
                    title: '场合',
                    options: ['职场', '休闲', '约会', '运动', '聚会'].map(o => [o, o] as [string, string]),
                    current: filterOccasion,
                    set: setFilterOccasion,
                  },
                  {
                    title: '季节',
                    options: ['春夏', '秋冬', '全季'].map(s => [s, s] as [string, string]),
                    current: filterSeason,
                    set: setFilterSeason,
                  },
                ].map(group => (
                  <div key={group.title}>
                    <p className="subsection-title" style={{ marginBottom: 'var(--space-2)' }}>{group.title}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                      {group.options.map(([v, l]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => group.set(group.current === v ? '' : v)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 'var(--radius-sm)',
                            border: group.current === v
                              ? '1px solid var(--color-accent)'
                              : '1px solid var(--color-border)',
                            background: group.current === v
                              ? 'rgba(66,133,244,0.08)'
                              : 'transparent',
                            color: group.current === v ? 'var(--color-accent)' : 'var(--color-ink-3)',
                            fontSize: 'var(--text-xs)',
                            fontFamily: 'var(--font-ui)',
                            cursor: 'pointer',
                            transition: 'all 150ms',
                          }}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Outfit banner */}
        {tab === 'all' && !filterMode && (
          <div style={{ flexShrink: 0, padding: 'var(--space-4) var(--space-6) var(--space-2)' }}>
            {!showOutfits ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-5)',
                borderRadius: 'var(--radius-lg)',
                background: 'linear-gradient(135deg, var(--color-surface-2), var(--color-surface))',
                border: '1px solid var(--color-border)',
                padding: 'var(--space-4) var(--space-5)',
              }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-medium)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>
                    今天穿什么？
                  </p>
                  <p style={{ marginTop: 2, fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
                    {new Date().toLocaleDateString('zh-CN', { weekday: 'long' })} · 让 AI 从你的穿搭库推荐搭配
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSuggestOutfit()}
                  disabled={outfitLoading}
                  className="btn-secondary"
                  style={{ height: 36, fontSize: 'var(--text-xs)' }}
                >
                  {outfitLoading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  让 AI 帮我搭
                </button>
              </div>
            ) : (
              <div style={{
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                padding: 'var(--space-4)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>
                    今日搭配推荐
                  </p>
                  <button type="button" onClick={() => setShowOutfits(false)} className="btn-icon">
                    <X size={14} />
                  </button>
                </div>
                {outfitLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)' }}>
                    <RefreshCw size={14} className="animate-spin" /> AI 正在分析你的穿搭库...
                  </div>
                )}
                {!outfitLoading && outfitMessage && (
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>{outfitMessage}</p>
                )}
                {!outfitLoading && outfits.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                    {outfits.map((outfit, i) => <OutfitCard key={i} outfit={outfit} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4) var(--space-6)' }}>

          {/* Loading */}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--color-ink-3)' }}>
              <RefreshCw size={14} className="animate-spin" /> 加载中...
            </div>
          )}

          {/* Empty */}
          {!loading && items.length === 0 && tab !== 'collections' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '96px 0', color: 'var(--color-ink-3)' }}>
              <Grid3X3 size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p style={{ fontSize: 'var(--text-base)', fontFamily: 'var(--font-ui)' }}>还没有图片</p>
              <p style={{ fontSize: 'var(--text-sm)', marginTop: 4, color: 'var(--color-ink-3)' }}>在设计工作台生成图片后会自动入库</p>
            </div>
          )}

          {/* Collections view */}
          {tab === 'collections' && !loading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-5)' }}>
              {collections.map(col => (
                <CollectionCard
                  key={col.id}
                  col={col}
                  items={itemsWithSession}
                  isSelected={selectedColId === col.id}
                  onSelect={() => setSelectedColId(col.id === selectedColId ? null : col.id)}
                  onDelete={() => void handleDeleteCollection(col.id)}
                />
              ))}
              <NewCollectionCard
                name={newColName}
                onChange={setNewColName}
                onCreate={() => void handleCreateCollection()}
                creating={creatingCol}
              />
            </div>
          )}

          {/* Items grid */}
          {!loading && tab !== 'collections' && groupedItems.map(group => (
            <div key={group.date} style={{ marginBottom: 'var(--space-8)' }}>
              <p style={{
                marginBottom: 'var(--space-3)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-medium)',
                letterSpacing: 'var(--tracking-widest)',
                textTransform: 'uppercase',
                color: 'var(--color-ink-3)',
                fontFamily: 'var(--font-ui)',
              }}>
                {group.date}
              </p>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 'var(--space-3)',
              }}>
                {group.items.map((item, i) => (
                  <ItemCardMemo
                    key={item.id}
                    item={item}
                    index={i}
                    onFavorite={handleFavoriteStable}
                    onDelete={handleDeleteStable}
                    onClick={setSelectedItem}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Infinite scroll loader */}
          <div ref={loaderRef} style={{ display: 'flex', justifyContent: 'center', padding: 8 }}>
            {loadingMore && <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--color-ink-3)' }} />}
          </div>

          {/* Style insights */}
          {!loading && stats && stats.total_count >= 20 && (
            <div style={{
              marginTop: 'var(--space-6)',
              borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              padding: 'var(--space-6)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-5)' }}>
                <div>
                  <h3 style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--text-xl)',
                    fontWeight: 'var(--weight-light)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--color-ink)',
                  }}>
                    你的风格洞察
                  </h3>
                  <p style={{ marginTop: 2, fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
                    基于 {stats.total_count} 张图片分析
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleAnalyzeLib()}
                  disabled={analyzingLib}
                  className="btn-ghost"
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--color-gold)', height: 32 }}
                >
                  {analyzingLib ? <RefreshCw size={12} className="animate-spin" /> : <Star size={12} />}
                  更新风格档案
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 'var(--space-5)' }}>
                {stats.top_colors.length > 0 && (
                  <div>
                    <p className="subsection-title">最常见颜色</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {stats.top_colors.slice(0, 3).map((c, i) => (
                        <span key={c.name} style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
                          {i > 0 && <span style={{ color: 'var(--color-ink-3)' }}> · </span>}
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {stats.top_silhouettes.length > 0 && (
                  <div>
                    <p className="subsection-title">偏好廓形</p>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
                      {stats.top_silhouettes[0].name}
                      {stats.total_count > 0 && ` (${Math.round(stats.top_silhouettes[0].count / stats.total_count * 100)}%)`}
                    </p>
                  </div>
                )}
                {stats.top_occasions.length > 0 && (
                  <div>
                    <p className="subsection-title">主要场合</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {stats.top_occasions.slice(0, 2).map((o, i) => (
                        <span key={o.name} style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
                          {i > 0 && <span style={{ color: 'var(--color-ink-3)' }}> · </span>}
                          {o.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {stats.top_styles.length > 0 && (
                  <div>
                    <p className="subsection-title">风格关键词</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {stats.top_styles.slice(0, 2).map((s, i) => (
                        <span key={s.name} style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
                          {i > 0 && <span style={{ color: 'var(--color-ink-3)' }}> · </span>}
                          {s.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Detail sidebar */}
      {selectedItem && (
        <DetailSidebar
          item={selectedItem}
          authToken={user.auth_token}
          collections={collections}
          onUpdate={handleItemUpdate}
          onClose={() => setSelectedItem(null)}
          onContinueInStudio={handleContinueInStudio}
        />
      )}
    </div>
  );
}
