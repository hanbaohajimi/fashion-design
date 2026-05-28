import { useState, useEffect, useCallback, useRef } from 'react';
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
  onFavorite,
  onDelete,
  onClick,
}: {
  item: LibraryItem;
  onFavorite: (id: string, val: boolean) => void;
  onDelete: (id: string) => void;
  onClick: (item: LibraryItem) => void;
}) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--paper)] shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(16,17,20,0.12)]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setMenuOpen(false); }}
      onClick={() => onClick(item)}
    >
      <img
        src={item.image_url}
        alt=""
        loading="lazy"
        className="w-full object-cover block"
        style={{ aspectRatio: '3/4' }}
      />
      {/* Hover overlay */}
      {hover && (
        <div className="absolute inset-0 bg-black/20 transition-all">
          <div
          className="absolute right-2 top-2 flex items-center gap-1"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => onFavorite(item.id, !item.is_favorite)}
              className={`flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
                item.is_favorite
                  ? 'bg-red-500 text-white'
                  : 'bg-white/84 text-[color:var(--text-secondary)] hover:bg-red-50 hover:text-red-500'
              }`}
            >
              <Heart className="w-3.5 h-3.5" fill={item.is_favorite ? 'currentColor' : 'none'} />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(m => !m)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/84 text-[color:var(--text-secondary)] backdrop-blur-sm transition-colors hover:bg-white"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-28 rounded-2xl border border-[color:var(--border-soft)] bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => { onDelete(item.id); setMenuOpen(false); }}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3 h-3" /> 删除
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Tags */}
      {item.auto_tags?.style_keywords?.length ? (
        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/40 to-transparent">
          <div className="flex flex-wrap gap-1">
            {item.auto_tags.style_keywords.slice(0, 2).map(k => (
              <span key={k} className="rounded-full bg-black/35 px-1.5 py-0.5 text-[9px] text-white/90 backdrop-blur-sm">{k}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Detail sidebar ────────────────────────────────────────

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

  // Version chain: items from same session
  const [versionChain, setVersionChain] = useState<LibraryItem[]>([]);

  useEffect(() => {
    setNotes(item.notes || '');
    setNotesChanged(false);
  }, [item.id]);

  useEffect(() => {
    if (!item.session_id) return;
    // We'll load version chain from the parent (already have items from same session)
    // For now leave it empty; parent can pass it
  }, [item.session_id]);

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
    <div className="flex h-full w-80 flex-col border-l border-[color:var(--border-soft)] bg-white">
      <div className="flex items-center justify-between border-b border-[color:var(--border-soft)] px-4 py-3">
        <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">图片详情</span>
        <button type="button" onClick={onClose} className="btn-ghost btn-square h-9 min-h-9 w-9">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <img src={item.image_url} alt="" className="w-full rounded-2xl object-cover" style={{ maxHeight: 300 }} />
        </div>

        <div className="flex items-center gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={handleFavorite}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              item.is_favorite
                ? 'bg-red-50 border-red-200 text-red-600'
                : 'border-[color:var(--border-soft)] text-[color:var(--text-secondary)] hover:border-red-200 hover:text-red-500'
            }`}
          >
            <Heart className="w-3.5 h-3.5" fill={item.is_favorite ? 'currentColor' : 'none'} />
            {item.is_favorite ? '已收藏' : '收藏'}
          </button>

          {/* Add to collection */}
          <div className="relative">
            <button type="button" onClick={() => setColMenuOpen(m => !m)} className="btn-secondary px-3 text-[12px] font-medium">
              <BookOpen className="w-3.5 h-3.5" /> 加入合集
            </button>
            {colMenuOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-44 overflow-y-auto rounded-2xl border border-[color:var(--border-soft)] bg-white py-1 shadow-lg">
                {collections.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-[color:var(--text-muted)]">暂无合集</p>
                )}
                {collections.map(col => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => handleAddToCollection(col.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[color:var(--text-secondary)] hover:bg-[color:var(--paper)]"
                  >
                    {col.is_smart && <Sparkles className="w-3 h-3 shrink-0 text-amber-500" />}
                    <span className="truncate">{col.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 px-4 pb-6">
          {allAutoTags.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">风格标签</p>
              <div className="flex flex-wrap gap-1.5">
                {allAutoTags.map((tag, i) => (
                  <span key={i} className="rounded-full border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-2 py-0.5 text-[11px] text-[color:var(--text-secondary)]">{tag}</span>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">我的标签</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {item.user_tags.map(tag => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-full border border-[rgba(47,107,255,0.14)] bg-[rgba(47,107,255,0.08)] px-2 py-0.5 text-[11px] text-[color:var(--signal-blue)]"
                >
                  {tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)} className="text-[rgba(47,107,255,0.7)] hover:text-[color:var(--signal-blue)]">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleAddTag(); }}
                placeholder="添加标签..."
                className="input-shell flex-1 text-[12px]"
              />
              <button
                type="button"
                onClick={() => void handleAddTag()}
                className="btn-primary btn-square h-10 min-h-10 w-10"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">备注</p>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setNotesChanged(true); }}
              placeholder="点击添加备注..."
              rows={3}
              className="input-shell resize-none text-[12px]"
            />
            {notesChanged && (
              <button
                type="button"
                onClick={() => void handleSaveNotes()}
                className="mt-1.5 text-[11px] text-[color:var(--signal-blue)] hover:text-[color:var(--signal-blue)]"
              >
                保存备注
              </button>
            )}
          </div>

          <div className="border-t border-[color:var(--border-soft)] pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">来源对话</p>
            <p className="mb-1 text-[12px] text-[color:var(--text-secondary)]">
              {new Date(item.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            {item.generation_prompt && (
              <p className="mb-3 line-clamp-2 text-[12px] text-[color:var(--text-primary)]">"{item.generation_prompt}"</p>
            )}
            <button
              type="button"
              onClick={() => onContinueInStudio(item)}
              className="btn-primary w-full text-[12px] font-semibold"
            >
              <ChevronRight className="w-3.5 h-3.5" /> 继续迭代
            </button>
          </div>

          <div className="border-t border-[color:var(--border-soft)] pt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">相似图片</p>
              {!similar.length && (
                <button type="button" onClick={() => void loadSimilar()} disabled={loadingSimilar} className="btn-ghost h-8 min-h-8 px-2 text-[11px]">
                  {loadingSimilar ? <RefreshCw className="w-3 h-3 animate-spin" /> : '加载'}
                </button>
              )}
            </div>
            {similar.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5">
                {similar.slice(0, 6).map(s => (
                  <img
                    key={s.id}
                    src={s.image_url}
                    alt=""
                    className="aspect-square w-full cursor-pointer rounded-xl object-cover transition-opacity hover:opacity-80"
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

// ── Version chain (designer) ──────────────────────────────

function VersionChain({ items }: { items: LibraryItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="border-b border-[color:var(--border-soft)] bg-[color:var(--paper)] px-4 py-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">版本链</p>
      <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {items.map((item, i) => (
          <div key={item.id} className="flex items-center gap-2 shrink-0">
            <div className="text-center">
              <img
                src={item.image_url}
                alt=""
                className="h-14 w-14 rounded-xl border-2 border-transparent object-cover transition-all hover:border-[color:var(--border-strong)]"
              />
              <p className="mt-1 text-[9px] text-[color:var(--text-muted)]">
                {new Date(item.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
              </p>
            </div>
            {i < items.length - 1 && <ChevronRight className="w-3 h-3 shrink-0 text-[color:var(--text-dim)]" />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Outfit suggestions ────────────────────────────────────

function OutfitCard({ outfit }: { outfit: OutfitSuggestion }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[color:var(--border-soft)] bg-white">
      <div className="flex gap-2 p-3">
        {outfit.items.slice(0, 3).map(item => (
          <img
            key={item.id}
            src={item.image_url}
            alt=""
            className="h-20 w-16 shrink-0 rounded-xl object-cover"
          />
        ))}
      </div>
      <div className="px-3 pb-3">
        <p className="text-[13px] text-[color:var(--text-secondary)]">{outfit.description}</p>
        {outfit.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {outfit.tags.map(t => (
              <span key={t} className="rounded-full bg-[color:var(--paper)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">{t}</span>
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

  // Version chain for selected item
  const [versionChain, setVersionChain] = useState<LibraryItem[]>([]);

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

  // Search on enter
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

  // Infinite scroll
  useEffect(() => {
    if (!loaderRef.current) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) void loadMore();
    }, { threshold: 0.1 });
    obs.observe(loaderRef.current);
    return () => obs.disconnect();
  }, [loadMore]);

  // Version chain for selected item
  useEffect(() => {
    if (!selectedItem?.session_id) { setVersionChain([]); return; }
    const chain = items
      .filter(i => i.session_id === selectedItem.session_id)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    setVersionChain(chain);
  }, [selectedItem, items]);

  const handleFavorite = async (id: string, val: boolean) => {
    try {
      const r = await patchLibraryItem(user.auth_token, id, { is_favorite: val });
      setItems(prev => prev.map(i => i.id === id ? r.item : i));
      if (selectedItem?.id === id) setSelectedItem(r.item);
    } catch { toast('操作失败', 'error'); }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除此图片？')) return;
    try {
      await deleteLibraryItem(user.auth_token, id);
      setItems(prev => prev.filter(i => i.id !== id));
      if (selectedItem?.id === id) setSelectedItem(null);
      toast('已删除', 'success');
    } catch { toast('删除失败', 'error'); }
  };

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

  // Group items by date
  const groupedItems: Array<{ date: string; items: LibraryItem[] }> = [];
  for (const item of items) {
    const date = new Date(item.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
    const last = groupedItems[groupedItems.length - 1];
    if (last && last.date === date) {
      last.items.push(item);
    } else {
      groupedItems.push({ date, items: [item] });
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-[color:var(--bg)]">
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex shrink-0 items-center gap-3 border-b border-[color:var(--border-soft)] bg-white px-6 py-3">
          <div className="flex items-center gap-1">
            {([['all', '全部'], ['favorites', '收藏'], ['collections', '合集']] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setSelectedColId(null); }}
                className={`rounded-xl px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  tab === t ? 'bg-[color:var(--ink)] text-white' : 'text-[color:var(--text-secondary)] hover:bg-[color:var(--paper)] hover:text-[color:var(--text-primary)]'
                }`}
              >
                {label}
                {t === 'all' && total > 0 && (
                  <span className={`ml-1.5 text-[10px] ${tab === t ? 'text-white/60' : 'text-[color:var(--text-muted)]'}`}>{total}</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-48">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
              placeholder="搜索标签..."
              className="input-shell py-1.5 pl-8 pr-3 text-[12px]"
            />
          </div>

          {/* Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen(o => !o)}
              className={`btn-ghost btn-square h-10 min-h-10 w-10 ${filterOpen ? 'bg-[color:var(--ink)] text-white hover:bg-[color:var(--ink)]' : ''}`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            {filterOpen && (
              <div className="dropdown-enter absolute right-0 top-full z-20 mt-2 w-64 space-y-3 rounded-3xl border border-[color:var(--border-soft)] bg-white p-4 shadow-lg">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-[color:var(--text-muted)]">模式</p>
                  <div className="flex gap-2">
                    {[['', '全部'], ['personal', '个人'], ['designer', '设计师']].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setFilterMode(v)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${filterMode === v ? 'border-[color:var(--ink)] bg-[color:var(--ink)] text-white' : 'border-[color:var(--border-soft)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-[color:var(--text-muted)]">场合</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['职场', '休闲', '约会', '运动', '聚会'].map(o => (
                      <button key={o} type="button" onClick={() => setFilterOccasion(filterOccasion === o ? '' : o)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${filterOccasion === o ? 'border-[color:var(--ink)] bg-[color:var(--ink)] text-white' : 'border-[color:var(--border-soft)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]'}`}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-[color:var(--text-muted)]">季节</p>
                  <div className="flex gap-2">
                    {['春夏', '秋冬', '全季'].map(s => (
                      <button key={s} type="button" onClick={() => setFilterSeason(filterSeason === s ? '' : s)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${filterSeason === s ? 'border-[color:var(--ink)] bg-[color:var(--ink)] text-white' : 'border-[color:var(--border-soft)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Collections sub-nav */}
        {tab === 'collections' && (
          <div className="shrink-0 border-b border-[color:var(--border-soft)] bg-white px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedColId(null)}
                className={`rounded-xl px-3 py-1.5 text-[12px] transition-colors ${!selectedColId ? 'bg-[color:var(--ink)] text-white' : 'text-[color:var(--text-secondary)] hover:bg-[color:var(--paper)]'}`}
              >
                全部合集
              </button>
              {collections.map(col => (
                <div key={col.id} className="relative group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedColId(col.id)}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] transition-colors ${selectedColId === col.id ? 'bg-[color:var(--ink)] text-white' : 'text-[color:var(--text-secondary)] hover:bg-[color:var(--paper)]'}`}
                  >
                    {col.is_smart && <Sparkles className="w-3 h-3 text-amber-500" />}
                    {col.name}
                    <span className="text-[10px] opacity-60">{col.item_count}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteCollection(col.id)}
                    className="hidden p-0.5 text-[color:var(--text-muted)] hover:text-red-500 group-hover:flex"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              {/* New collection */}
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newColName}
                  onChange={e => setNewColName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void handleCreateCollection(); }}
                  placeholder="新建合集..."
                  className="input-shell w-28 text-[12px]"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateCollection()}
                  disabled={creatingCol || !newColName.trim()}
                  className="btn-primary btn-square h-10 min-h-10 w-10 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Today's outfit banner — personal mode only */}
        {tab === 'all' && !filterMode && (
          <div className="shrink-0 mx-6 mt-4 mb-2">
            {!showOutfits ? (
              <div className="flex items-center gap-4 rounded-3xl bg-[linear-gradient(135deg,var(--ink),#25282f)] px-5 py-4 text-white">
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-white">今天穿什么？</p>
                  <p className="mt-0.5 text-[11px] text-white/60">
                    {new Date().toLocaleDateString('zh-CN', { weekday: 'long' })} · 让 AI 从你的穿搭库推荐搭配
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSuggestOutfit()}
                  disabled={outfitLoading}
                  className="btn-secondary px-4 text-[12px] font-semibold disabled:opacity-60"
                >
                  {outfitLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  让 AI 帮我搭
                </button>
              </div>
            ) : (
              <div className="rounded-3xl border border-[color:var(--border-soft)] bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">今日搭配推荐</p>
                  <button type="button" onClick={() => setShowOutfits(false)} className="btn-ghost btn-square h-9 min-h-9 w-9">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {outfitLoading && (
                  <div className="flex items-center gap-2 py-4 text-[12px] text-[color:var(--text-muted)]">
                    <RefreshCw className="w-4 h-4 animate-spin" /> AI 正在分析你的穿搭库...
                  </div>
                )}
                {!outfitLoading && outfitMessage && (
                  <p className="text-[12px] text-[color:var(--text-secondary)]">{outfitMessage}</p>
                )}
                {!outfitLoading && outfits.length > 0 && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {outfits.map((outfit, i) => <OutfitCard key={i} outfit={outfit} />)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Image grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-20 text-[13px] text-[color:var(--text-muted)]">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> 加载中...
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-[color:var(--text-muted)]">
              <Grid3X3 className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-[14px]">还没有图片</p>
              <p className="text-[12px] mt-1">在设计工作台生成图片后会自动入库</p>
            </div>
          )}

          {!loading && groupedItems.map(group => (
            <div key={group.date} className="mb-6">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">{group.date}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {group.items.map(item => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    onFavorite={(id, val) => void handleFavorite(id, val)}
                    onDelete={(id) => void handleDelete(id)}
                    onClick={setSelectedItem}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Infinite scroll loader */}
          <div ref={loaderRef} className="flex justify-center py-2">
            {loadingMore && <RefreshCw className="w-4 h-4 animate-spin text-[color:var(--text-muted)]" />}
          </div>

          {/* Style insights (≥20 items) */}
          {!loading && stats && stats.total_count >= 20 && (
            <div className="mt-6 rounded-3xl border border-[color:var(--border-soft)] bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">你的风格洞察</p>
                  <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">基于 {stats.total_count} 张图片分析</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleAnalyzeLib()}
                  disabled={analyzingLib}
                  className="btn-secondary px-3 text-[12px] disabled:opacity-50"
                >
                  {analyzingLib ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
                  更新风格档案
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {stats.top_colors.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] text-[color:var(--text-muted)]">最常见颜色</p>
                    <div className="flex flex-wrap gap-1">
                      {stats.top_colors.slice(0, 3).map(c => (
                        <span key={c.name} className="text-[11px] text-[color:var(--text-secondary)]">{c.name}</span>
                      )).reduce((acc, el, i) => [...acc, ...(i > 0 ? [<span key={`sep-${i}`} className="text-[color:var(--text-dim)]">·</span>] : []), el], [] as React.ReactNode[])}
                    </div>
                  </div>
                )}
                {stats.top_silhouettes.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] text-[color:var(--text-muted)]">偏好廓形</p>
                    <p className="text-[11px] text-[color:var(--text-secondary)]">
                      {stats.top_silhouettes[0].name}
                      {stats.total_count > 0 && ` (${Math.round(stats.top_silhouettes[0].count / stats.total_count * 100)}%)`}
                    </p>
                  </div>
                )}
                {stats.top_occasions.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] text-[color:var(--text-muted)]">主要场合</p>
                    <div className="flex flex-wrap gap-1">
                      {stats.top_occasions.slice(0, 2).map(o => (
                        <span key={o.name} className="text-[11px] text-[color:var(--text-secondary)]">{o.name}</span>
                      )).reduce((acc, el, i) => [...acc, ...(i > 0 ? [<span key={`sep-${i}`} className="text-[color:var(--text-dim)]">·</span>] : []), el], [] as React.ReactNode[])}
                    </div>
                  </div>
                )}
                {stats.top_styles.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] text-[color:var(--text-muted)]">风格关键词</p>
                    <div className="flex flex-wrap gap-1">
                      {stats.top_styles.slice(0, 2).map(s => (
                        <span key={s.name} className="text-[11px] text-[color:var(--text-secondary)]">{s.name}</span>
                      )).reduce((acc, el, i) => [...acc, ...(i > 0 ? [<span key={`sep-${i}`} className="text-[color:var(--text-dim)]">·</span>] : []), el], [] as React.ReactNode[])}
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

      {/* Version chain overlay at top of sidebar when designer mode */}
      {selectedItem && versionChain.length >= 2 && selectedItem.mode === 'designer' && (
        <div className="absolute left-0 right-80 bottom-0 pointer-events-none">
          {/* rendered inside the detail sidebar header area */}
        </div>
      )}
    </div>
  );
}
