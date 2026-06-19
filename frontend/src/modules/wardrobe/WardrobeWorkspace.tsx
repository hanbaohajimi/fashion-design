import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shirt, Sparkles, Package, Footprints, Watch, Gem,
  HelpCircle, LayoutGrid, Palette, RefreshCw,
} from 'lucide-react';
import { useToast } from '../../components/Toast';
import type { WardrobeItem, Outfit, WardrobeStats, WardrobeCategory } from '../../types/profile';
import {
  fetchWardrobeItems,
  uploadToWardrobe,
  deleteWardrobeItem,
  patchWardrobeItem,
  fetchWardrobeStats,
  createOutfit,
  fetchOutfits,
  deleteOutfit,
} from '../../api/profileApi';

import WardrobeHeader, { type ViewTab } from './components/WardrobeHeader';
import ItemCard from './components/ItemCard';
import OutfitCard from './components/OutfitCard';
import UploadModal from './components/UploadModal';
import WardrobeDetailDrawer from './components/WardrobeDetailDrawer';

import './wardrobe.css';

interface WardrobeProps {
  user: { email: string; name: string; auth_token: string };
}

const CATEGORIES: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: '全部', icon: <LayoutGrid className="w-3.5 h-3.5" strokeWidth={1.5} /> },
  { key: 'top', label: '上装', icon: <Shirt className="w-3.5 h-3.5" strokeWidth={1.5} /> },
  { key: 'bottom', label: '下装', icon: <Package className="w-3.5 h-3.5" strokeWidth={1.5} /> },
  { key: 'suit', label: '套装', icon: <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} /> },
  { key: 'shoes', label: '鞋子', icon: <Footprints className="w-3.5 h-3.5" strokeWidth={1.5} /> },
  { key: 'bag', label: '包包', icon: <Package className="w-3.5 h-3.5" strokeWidth={1.5} /> },
  { key: 'jewelry', label: '首饰', icon: <Gem className="w-3.5 h-3.5" strokeWidth={1.5} /> },
  { key: 'accessory', label: '配饰', icon: <Watch className="w-3.5 h-3.5" strokeWidth={1.5} /> },
  { key: 'uncategorized', label: '未分类', icon: <HelpCircle className="w-3.5 h-3.5" strokeWidth={1.5} /> },
];

const SOURCE_FILTERS = [
  { key: '', label: '全部来源' },
  { key: 'trend', label: '时尚趋势' },
  { key: 'design', label: '我的设计' },
  { key: 'upload', label: '我的上传' },
];

export default function WardrobeWorkspace({ user }: WardrobeProps) {
  const { toast } = useToast();
  const authToken = user.auth_token;

  const [viewTab, setViewTab] = useState<ViewTab>('wardrobe');
  const [category, setCategory] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<WardrobeStats | null>(null);

  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [outfitsLoading, setOutfitsLoading] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [selectedItem, setSelectedItem] = useState<WardrobeItem | null>(null);
  const [showOutfitCreate, setShowOutfitCreate] = useState(false);
  const [outfitSelection, setOutfitSelection] = useState<Set<string>>(new Set());

  const fileRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const data = await fetchWardrobeItems(authToken, {
        category: category === 'all' ? undefined : category,
        source_type: sourceFilter || undefined,
        search: search || undefined,
        page: p,
        limit: 30,
      });
      setItems(p === 1 ? data.items : prev => [...prev, ...data.items]);
      setTotal(data.total);
      setPage(p);
    } catch { toast('加载衣橱失败', 'error'); }
    setLoading(false);
  }, [authToken, category, sourceFilter, search, toast]);

  useEffect(() => { loadItems(1); }, [loadItems]);

  useEffect(() => {
    fetchWardrobeStats(authToken).then(setStats).catch(() => {});
  }, [authToken, items.length]);

  const loadOutfits = useCallback(async () => {
    setOutfitsLoading(true);
    try {
      const data = await fetchOutfits(authToken);
      setOutfits(data.outfits);
    } catch { toast('加载穿搭失败', 'error'); }
    setOutfitsLoading(false);
  }, [authToken, toast]);

  useEffect(() => {
    if (viewTab === 'outfits') loadOutfits();
  }, [viewTab, loadOutfits]);

  const handleUpload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      try {
        await uploadToWardrobe(authToken, file);
        toast('已添加到衣橱', 'success');
      } catch { toast('上传失败', 'error'); }
    }
    setShowUpload(false);
    loadItems(1);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWardrobeItem(authToken, id);
      setItems(prev => prev.filter(i => i.id !== id));
      setTotal(prev => prev - 1);
      if (selectedItem?.id === id) setSelectedItem(null);
      toast('已删除', 'success');
    } catch { toast('删除失败', 'error'); }
  };

  const handleToggleFavorite = async (item: WardrobeItem) => {
    try {
      const { item: updated } = await patchWardrobeItem(authToken, item.id, { favorite: !item.favorite });
      setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
      if (selectedItem?.id === updated.id) setSelectedItem(updated);
    } catch { toast('操作失败', 'error'); }
  };

  const handleCreateOutfit = async (name: string) => {
    if (outfitSelection.size === 0) { toast('请至少选择一件衣物', 'error'); return; }
    try {
      await createOutfit(authToken, name, Array.from(outfitSelection));
      toast('穿搭方案已创建', 'success');
      setOutfitSelection(new Set());
      setShowOutfitCreate(false);
      if (viewTab === 'outfits') loadOutfits();
    } catch { toast('创建失败', 'error'); }
  };

  const handleDeleteOutfit = async (id: string) => {
    try {
      await deleteOutfit(authToken, id);
      setOutfits(prev => prev.filter(o => o.id !== id));
      toast('已删除穿搭', 'success');
    } catch { toast('删除失败', 'error'); }
  };

  const catCounts = stats?.by_category ?? {};

  return (
    <div className="wardrobe-shell">
      <WardrobeHeader
        viewTab={viewTab}
        setViewTab={setViewTab}
        stats={stats}
        search={search}
        setSearch={setSearch}
        sourceFilter={sourceFilter}
        setSourceFilter={setSourceFilter}
        sourceFilters={SOURCE_FILTERS}
        onUploadClick={() => setShowUpload(true)}
        onNewOutfit={() => { setViewTab('wardrobe'); setShowOutfitCreate(true); }}
      />

      {viewTab === 'wardrobe' && (
        <div className="wardrobe-cat-rail">
          {CATEGORIES.map(cat => {
            const active = category === cat.key;
            const count = cat.key === 'all' ? (stats?.total ?? 0) : (catCounts[cat.key] ?? 0);
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setCategory(cat.key)}
                className={`wardrobe-cat ${active ? 'active' : ''}`}
              >
                {cat.icon}
                {cat.label}
                <span className="wardrobe-cat-count">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {showOutfitCreate && viewTab === 'wardrobe' && (
        <OutfitCreationBar
          selection={outfitSelection}
          onCancel={() => { setShowOutfitCreate(false); setOutfitSelection(new Set()); }}
          onCreate={handleCreateOutfit}
        />
      )}

      <div className="wardrobe-body">
        {viewTab === 'wardrobe' && (
          <>
            {loading && items.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 96 }}>
                <RefreshCw className="w-5 h-5 animate-spin" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
              </div>
            ) : items.length === 0 ? (
              <div className="wardrobe-empty">
                <Shirt className="w-10 h-10" strokeWidth={1} style={{ color: 'var(--color-ink-4)' }} />
                <p className="wardrobe-empty-quote">
                  &ldquo;A closet without intention is just laundry.&rdquo;
                </p>
                <p className="wardrobe-empty-hint">Upload to begin your archive</p>
              </div>
            ) : (
              <>
                <div className="wardrobe-grid">
                  {items.map(item => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      selecting={showOutfitCreate}
                      selected={outfitSelection.has(item.id)}
                      onSelect={() => {
                        if (showOutfitCreate) {
                          setOutfitSelection(prev => {
                            const next = new Set(prev);
                            if (next.has(item.id)) next.delete(item.id);
                            else next.add(item.id);
                            return next;
                          });
                        } else {
                          setSelectedItem(item);
                        }
                      }}
                      onFavorite={() => handleToggleFavorite(item)}
                    />
                  ))}
                </div>
                {items.length < total && (
                  <div className="wardrobe-load-more">
                    <button
                      type="button"
                      onClick={() => loadItems(page + 1)}
                      disabled={loading}
                    >
                      {loading ? '加载中…' : 'Load more · 加载更多'}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {viewTab === 'outfits' && (
          <>
            {outfitsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 96 }}>
                <RefreshCw className="w-5 h-5 animate-spin" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
              </div>
            ) : outfits.length === 0 ? (
              <div className="wardrobe-empty">
                <Palette className="w-10 h-10" strokeWidth={1} style={{ color: 'var(--color-ink-4)' }} />
                <p className="wardrobe-empty-quote">
                  &ldquo;An outfit is an idea wearing clothes.&rdquo;
                </p>
                <p className="wardrobe-empty-hint">Curate from your closet</p>
              </div>
            ) : (
              <div className="wardrobe-grid-outfits">
                {outfits.map(outfit => (
                  <OutfitCard key={outfit.id} outfit={outfit} onDelete={() => handleDeleteOutfit(outfit.id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {showUpload && (
        <UploadModal
          onUpload={handleUpload}
          onClose={() => setShowUpload(false)}
          fileRef={fileRef}
        />
      )}

      {selectedItem && (
        <WardrobeDetailDrawer
          item={selectedItem}
          authToken={authToken}
          categories={CATEGORIES.map(c => ({ key: c.key, label: c.label }))}
          onClose={() => setSelectedItem(null)}
          onUpdate={(updated) => {
            setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
            setSelectedItem(updated);
          }}
          onDelete={() => { handleDelete(selectedItem.id); setSelectedItem(null); }}
        />
      )}
    </div>
  );
}

// ── OutfitCreationBar (inline, small enough to keep) ─────────────────────────

function OutfitCreationBar({
  selection, onCancel, onCreate,
}: {
  selection: Set<string>;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <div className="wardrobe-outfit-bar">
      <div>
        <div className="outfit-bar-kicker">Compose · 创建穿搭</div>
        <span className="outfit-bar-text">
          已选 {selection.size} 件 · 给这套搭配一个名字
        </span>
      </div>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="如：周末轻松通勤"
      />
      <button
        type="button"
        onClick={() => onCreate(name || '我的穿搭')}
        disabled={selection.size === 0}
        className="outfit-bar-create"
      >
        创建
      </button>
      <button type="button" onClick={onCancel} className="outfit-bar-cancel">
        取消
      </button>
    </div>
  );
}
