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
      className="relative group rounded-xl overflow-hidden bg-gray-100 cursor-pointer"
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
            className="absolute top-2 right-2 flex items-center gap-1"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => onFavorite(item.id, !item.is_favorite)}
              className={`p-1.5 rounded-full backdrop-blur-sm transition-colors ${
                item.is_favorite
                  ? 'bg-red-500 text-white'
                  : 'bg-white/80 text-gray-600 hover:bg-red-50 hover:text-red-500'
              }`}
            >
              <Heart className="w-3.5 h-3.5" fill={item.is_favorite ? 'currentColor' : 'none'} />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(m => !m)}
                className="p-1.5 rounded-full bg-white/80 text-gray-600 hover:bg-white backdrop-blur-sm transition-colors"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-28 bg-white rounded-lg shadow-lg border border-gray-100 z-10 py-1">
                  <button
                    type="button"
                    onClick={() => { onDelete(item.id); setMenuOpen(false); }}
                    className="w-full px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-red-50 flex items-center gap-1.5"
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
              <span key={k} className="text-[9px] text-white/90 bg-black/30 px-1.5 py-0.5 rounded-full backdrop-blur-sm">{k}</span>
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
    <div className="w-80 border-l border-gray-100 flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-[13px] font-semibold text-gray-900">图片详情</span>
        <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Image */}
        <div className="p-4">
          <img src={item.image_url} alt="" className="w-full rounded-xl object-cover" style={{ maxHeight: 300 }} />
        </div>

        {/* Actions */}
        <div className="px-4 pb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={handleFavorite}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
              item.is_favorite
                ? 'bg-red-50 border-red-200 text-red-600'
                : 'border-gray-200 text-gray-600 hover:border-red-200 hover:text-red-500'
            }`}
          >
            <Heart className="w-3.5 h-3.5" fill={item.is_favorite ? 'currentColor' : 'none'} />
            {item.is_favorite ? '已收藏' : '收藏'}
          </button>

          {/* Add to collection */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setColMenuOpen(m => !m)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-200 text-gray-600 hover:border-gray-400 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" /> 加入合集
            </button>
            {colMenuOpen && (
              <div className="absolute left-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-gray-100 z-20 py-1 max-h-48 overflow-y-auto">
                {collections.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-gray-400">暂无合集</p>
                )}
                {collections.map(col => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => handleAddToCollection(col.id)}
                    className="w-full px-3 py-2 text-left text-[12px] text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    {col.is_smart && <Sparkles className="w-3 h-3 text-amber-500 shrink-0" />}
                    <span className="truncate">{col.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-4 space-y-4 pb-6">
          {/* Auto tags */}
          {allAutoTags.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">风格标签</p>
              <div className="flex flex-wrap gap-1.5">
                {allAutoTags.map((tag, i) => (
                  <span key={i} className="px-2 py-0.5 text-[11px] bg-gray-50 text-gray-700 rounded-full border border-gray-200">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* User tags */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">我的标签</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {item.user_tags.map(tag => (
                <span
                  key={tag}
                  className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-blue-50 text-blue-700 rounded-full border border-blue-100"
                >
                  {tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)} className="text-blue-400 hover:text-blue-700">
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
                className="flex-1 text-[12px] px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-gray-400"
              />
              <button
                type="button"
                onClick={() => void handleAddTag()}
                className="p-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">备注</p>
            <textarea
              value={notes}
              onChange={e => { setNotes(e.target.value); setNotesChanged(true); }}
              placeholder="点击添加备注..."
              rows={3}
              className="w-full text-[12px] px-2.5 py-2 border border-gray-200 rounded-lg outline-none focus:border-gray-400 resize-none"
            />
            {notesChanged && (
              <button
                type="button"
                onClick={() => void handleSaveNotes()}
                className="mt-1.5 text-[11px] text-blue-600 hover:text-blue-800"
              >
                保存备注
              </button>
            )}
          </div>

          {/* Source + actions */}
          <div className="border-t border-gray-100 pt-4">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">来源对话</p>
            <p className="text-[12px] text-gray-500 mb-1">
              {new Date(item.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            {item.generation_prompt && (
              <p className="text-[12px] text-gray-700 line-clamp-2 mb-3">"{item.generation_prompt}"</p>
            )}
            <button
              type="button"
              onClick={() => onContinueInStudio(item)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-[12px] font-medium rounded-lg hover:bg-gray-800 transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" /> 继续迭代
            </button>
          </div>

          {/* Similar images */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">相似图片</p>
              {!similar.length && (
                <button
                  type="button"
                  onClick={() => void loadSimilar()}
                  disabled={loadingSimilar}
                  className="text-[11px] text-gray-500 hover:text-gray-800 flex items-center gap-1"
                >
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
                    className="w-full aspect-square object-cover rounded-lg cursor-pointer hover:opacity-80 transition-opacity"
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
    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">版本链</p>
      <div className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {items.map((item, i) => (
          <div key={item.id} className="flex items-center gap-2 shrink-0">
            <div className="text-center">
              <img
                src={item.image_url}
                alt=""
                className="w-14 h-14 object-cover rounded-lg border-2 border-transparent hover:border-gray-400 transition-all"
              />
              <p className="text-[9px] text-gray-400 mt-1">
                {new Date(item.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
              </p>
            </div>
            {i < items.length - 1 && <ChevronRight className="w-3 h-3 text-gray-300 shrink-0" />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Outfit suggestions ────────────────────────────────────

function OutfitCard({ outfit }: { outfit: OutfitSuggestion }) {
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex gap-2 p-3">
        {outfit.items.slice(0, 3).map(item => (
          <img
            key={item.id}
            src={item.image_url}
            alt=""
            className="w-16 h-20 object-cover rounded-lg shrink-0"
          />
        ))}
      </div>
      <div className="px-3 pb-3">
        <p className="text-[13px] text-gray-700">{outfit.description}</p>
        {outfit.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {outfit.tags.map(t => (
              <span key={t} className="text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full">{t}</span>
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
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header bar */}
        <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-white">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            {([['all', '全部'], ['favorites', '收藏'], ['collections', '合集']] as [Tab, string][]).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setSelectedColId(null); }}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  tab === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {label}
                {t === 'all' && total > 0 && (
                  <span className={`ml-1.5 text-[10px] ${tab === t ? 'text-white/60' : 'text-gray-400'}`}>{total}</span>
                )}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-48">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
              placeholder="搜索标签..."
              className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-gray-200 rounded-lg outline-none focus:border-gray-400"
            />
          </div>

          {/* Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen(o => !o)}
              className={`p-2 rounded-lg transition-colors ${filterOpen ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-lg border border-gray-100 z-20 p-4 space-y-3">
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 mb-1.5">模式</p>
                  <div className="flex gap-2">
                    {[['', '全部'], ['personal', '个人'], ['designer', '设计师']].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setFilterMode(v)}
                        className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${filterMode === v ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 mb-1.5">场合</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['职场', '休闲', '约会', '运动', '聚会'].map(o => (
                      <button key={o} type="button" onClick={() => setFilterOccasion(filterOccasion === o ? '' : o)}
                        className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${filterOccasion === o ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 mb-1.5">季节</p>
                  <div className="flex gap-2">
                    {['春夏', '秋冬', '全季'].map(s => (
                      <button key={s} type="button" onClick={() => setFilterSeason(filterSeason === s ? '' : s)}
                        className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${filterSeason === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
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
          <div className="shrink-0 px-6 py-3 border-b border-gray-100 bg-white">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setSelectedColId(null)}
                className={`px-3 py-1.5 rounded-lg text-[12px] transition-colors ${!selectedColId ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                全部合集
              </button>
              {collections.map(col => (
                <div key={col.id} className="relative group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedColId(col.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] transition-colors ${selectedColId === col.id ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                  >
                    {col.is_smart && <Sparkles className="w-3 h-3 text-amber-400" />}
                    {col.name}
                    <span className="text-[10px] opacity-60">{col.item_count}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteCollection(col.id)}
                    className="hidden group-hover:flex p-0.5 text-gray-400 hover:text-red-500"
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
                  className="text-[12px] px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-gray-400 w-28"
                />
                <button
                  type="button"
                  onClick={() => void handleCreateCollection()}
                  disabled={creatingCol || !newColName.trim()}
                  className="p-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
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
              <div className="flex items-center gap-4 px-5 py-4 bg-gradient-to-r from-gray-900 to-gray-700 rounded-2xl">
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-white">今天穿什么？</p>
                  <p className="text-[11px] text-white/60 mt-0.5">
                    {new Date().toLocaleDateString('zh-CN', { weekday: 'long' })} · 让 AI 从你的穿搭库推荐搭配
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSuggestOutfit()}
                  disabled={outfitLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-white text-gray-900 text-[12px] font-semibold rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-60"
                >
                  {outfitLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  让 AI 帮我搭
                </button>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-semibold text-gray-900">今日搭配推荐</p>
                  <button type="button" onClick={() => setShowOutfits(false)} className="text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {outfitLoading && (
                  <div className="flex items-center gap-2 py-4 text-gray-400 text-[12px]">
                    <RefreshCw className="w-4 h-4 animate-spin" /> AI 正在分析你的穿搭库...
                  </div>
                )}
                {!outfitLoading && outfitMessage && (
                  <p className="text-[12px] text-gray-500">{outfitMessage}</p>
                )}
                {!outfitLoading && outfits.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
            <div className="flex items-center justify-center py-20 text-gray-400 text-[13px]">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> 加载中...
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
              <Grid3X3 className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-[14px]">还没有图片</p>
              <p className="text-[12px] mt-1">在设计工作台生成图片后会自动入库</p>
            </div>
          )}

          {!loading && groupedItems.map(group => (
            <div key={group.date} className="mb-6">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">{group.date}</p>
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
          <div ref={loaderRef} className="py-2 flex justify-center">
            {loadingMore && <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />}
          </div>

          {/* Style insights (≥20 items) */}
          {!loading && stats && stats.total_count >= 20 && (
            <div className="mt-6 p-5 bg-white border border-gray-200 rounded-2xl">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[14px] font-semibold text-gray-900">你的风格洞察</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">基于 {stats.total_count} 张图片分析</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleAnalyzeLib()}
                  disabled={analyzingLib}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {analyzingLib ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Star className="w-3.5 h-3.5" />}
                  更新风格档案
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {stats.top_colors.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">最常见颜色</p>
                    <div className="flex flex-wrap gap-1">
                      {stats.top_colors.slice(0, 3).map(c => (
                        <span key={c.name} className="text-[11px] text-gray-700">{c.name}</span>
                      )).reduce((acc, el, i) => [...acc, ...(i > 0 ? [<span key={`sep-${i}`} className="text-gray-300">·</span>] : []), el], [] as React.ReactNode[])}
                    </div>
                  </div>
                )}
                {stats.top_silhouettes.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">偏好廓形</p>
                    <p className="text-[11px] text-gray-700">
                      {stats.top_silhouettes[0].name}
                      {stats.total_count > 0 && ` (${Math.round(stats.top_silhouettes[0].count / stats.total_count * 100)}%)`}
                    </p>
                  </div>
                )}
                {stats.top_occasions.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">主要场合</p>
                    <div className="flex flex-wrap gap-1">
                      {stats.top_occasions.slice(0, 2).map(o => (
                        <span key={o.name} className="text-[11px] text-gray-700">{o.name}</span>
                      )).reduce((acc, el, i) => [...acc, ...(i > 0 ? [<span key={`sep-${i}`} className="text-gray-300">·</span>] : []), el], [] as React.ReactNode[])}
                    </div>
                  </div>
                )}
                {stats.top_styles.length > 0 && (
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">风格关键词</p>
                    <div className="flex flex-wrap gap-1">
                      {stats.top_styles.slice(0, 2).map(s => (
                        <span key={s.name} className="text-[11px] text-gray-700">{s.name}</span>
                      )).reduce((acc, el, i) => [...acc, ...(i > 0 ? [<span key={`sep-${i}`} className="text-gray-300">·</span>] : []), el], [] as React.ReactNode[])}
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
