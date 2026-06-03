import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, Search, Plus, Shirt, X, RefreshCw,
  Palette, Sparkles, Package,
  Footprints, Watch, Gem, HelpCircle, LayoutGrid,
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

interface WardrobeProps {
  user: { email: string; name: string; auth_token: string };
}

const CATEGORIES: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: '全部', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { key: 'top', label: '上装', icon: <Shirt className="w-3.5 h-3.5" /> },
  { key: 'bottom', label: '下装', icon: <Package className="w-3.5 h-3.5" /> },
  { key: 'suit', label: '套装', icon: <Sparkles className="w-3.5 h-3.5" /> },
  { key: 'shoes', label: '鞋子', icon: <Footprints className="w-3.5 h-3.5" /> },
  { key: 'bag', label: '包包', icon: <Package className="w-3.5 h-3.5" /> },
  { key: 'jewelry', label: '首饰', icon: <Gem className="w-3.5 h-3.5" /> },
  { key: 'accessory', label: '配饰', icon: <Watch className="w-3.5 h-3.5" /> },
  { key: 'uncategorized', label: '未分类', icon: <HelpCircle className="w-3.5 h-3.5" /> },
];

const SOURCE_FILTERS = [
  { key: '', label: '全部来源' },
  { key: 'trend', label: '时尚趋势' },
  { key: 'design', label: '我的设计' },
  { key: 'upload', label: '我的上传' },
];

const SOURCE_COLORS: Record<string, string> = {
  trend: 'var(--color-accent, #2563eb)',
  design: '#7c3aed',
  upload: '#059669',
};

type ViewTab = 'wardrobe' | 'outfits';

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
    <div className="flex h-full flex-col overflow-hidden" style={{ background: 'var(--color-bg, #fafafa)' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3, 12px)',
        padding: 'var(--space-3, 12px) var(--space-5, 20px)',
        borderBottom: '1px solid var(--color-border, #e5e5e5)',
        background: 'var(--color-surface, #fff)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 'var(--space-1, 4px)' }}>
          {(['wardrobe', 'outfits'] as ViewTab[]).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setViewTab(tab)}
              style={{
                padding: '6px 16px',
                borderRadius: 'var(--radius-pill, 9999px)',
                fontSize: 'var(--text-sm, 14px)',
                fontWeight: viewTab === tab ? 'var(--weight-medium, 500)' : 'normal',
                fontFamily: 'var(--font-ui)',
                background: viewTab === tab ? 'var(--color-ink, #1a1a1a)' : 'transparent',
                color: viewTab === tab ? '#fff' : 'var(--color-ink-3, #999)',
                border: 'none', cursor: 'pointer', transition: 'all 150ms',
              }}
            >
              {tab === 'wardrobe' ? '我的衣橱' : '穿搭方案'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {viewTab === 'wardrobe' && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2, 8px)',
              padding: '4px 12px',
              borderRadius: 'var(--radius-md, 8px)',
              border: '1px solid var(--color-border, #e5e5e5)',
              background: 'var(--color-surface-2, #f5f5f5)',
              minWidth: 200,
            }}>
              <Search className="w-3.5 h-3.5" style={{ color: 'var(--color-ink-3, #999)', flexShrink: 0 }} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索衣物..."
                style={{
                  border: 'none', outline: 'none', background: 'transparent', flex: 1,
                  fontSize: 'var(--text-sm, 14px)', fontFamily: 'var(--font-ui)',
                  color: 'var(--color-ink, #1a1a1a)',
                }}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                  <X className="w-3 h-3" style={{ color: 'var(--color-ink-3)' }} />
                </button>
              )}
            </div>

            <select
              value={sourceFilter}
              onChange={e => setSourceFilter(e.target.value)}
              style={{
                padding: '6px 12px', borderRadius: 'var(--radius-md, 8px)',
                border: '1px solid var(--color-border, #e5e5e5)',
                fontSize: 'var(--text-sm, 14px)', fontFamily: 'var(--font-ui)',
                background: 'var(--color-surface, #fff)', color: 'var(--color-ink, #1a1a1a)',
                cursor: 'pointer',
              }}
            >
              {SOURCE_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>

            <button
              type="button"
              onClick={() => setShowUpload(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px',
                borderRadius: 'var(--radius-md, 8px)',
                background: 'var(--color-ink, #1a1a1a)', color: '#fff',
                border: 'none', cursor: 'pointer',
                fontSize: 'var(--text-sm, 14px)', fontWeight: 'var(--weight-medium, 500)', fontFamily: 'var(--font-ui)',
              }}
            >
              <Upload className="w-3.5 h-3.5" /> 上传衣物
            </button>
          </>
        )}

        {viewTab === 'outfits' && (
          <button
            type="button"
            onClick={() => { setViewTab('wardrobe'); setShowOutfitCreate(true); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px',
              borderRadius: 'var(--radius-md, 8px)',
              background: 'var(--color-ink, #1a1a1a)', color: '#fff',
              border: 'none', cursor: 'pointer',
              fontSize: 'var(--text-sm, 14px)', fontWeight: 'var(--weight-medium, 500)', fontFamily: 'var(--font-ui)',
            }}
          >
            <Plus className="w-3.5 h-3.5" /> 新建穿搭
          </button>
        )}
      </div>

      {/* Category tabs */}
      {viewTab === 'wardrobe' && (
        <div style={{
          display: 'flex', gap: 'var(--space-1, 4px)',
          padding: 'var(--space-2, 8px) var(--space-5, 20px)',
          borderBottom: '1px solid var(--color-border, #e5e5e5)',
          background: 'var(--color-surface, #fff)',
          overflowX: 'auto',
          flexShrink: 0,
        }}>
          {CATEGORIES.map(cat => {
            const active = category === cat.key;
            const count = cat.key === 'all' ? (stats?.total ?? 0) : (catCounts[cat.key] ?? 0);
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setCategory(cat.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-pill, 9999px)',
                  fontSize: 'var(--text-xs, 12px)', fontFamily: 'var(--font-ui)',
                  fontWeight: active ? 'var(--weight-medium, 500)' : 'normal',
                  background: active ? 'var(--color-ink, #1a1a1a)' : 'transparent',
                  color: active ? '#fff' : 'var(--color-ink-2, #666)',
                  border: active ? 'none' : '1px solid var(--color-border, #e5e5e5)',
                  cursor: 'pointer', transition: 'all 150ms',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {cat.icon}
                {cat.label}
                <span style={{
                  fontSize: 10, opacity: 0.7,
                  background: active ? 'rgba(255,255,255,0.2)' : 'var(--color-surface-3, #eee)',
                  padding: '1px 6px', borderRadius: 'var(--radius-pill, 9999px)',
                }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Outfit creation bar */}
      {showOutfitCreate && viewTab === 'wardrobe' && (
        <OutfitCreationBar
          selection={outfitSelection}
          onCancel={() => { setShowOutfitCreate(false); setOutfitSelection(new Set()); }}
          onCreate={handleCreateOutfit}
        />
      )}

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4, 16px) var(--space-5, 20px)' }}>
        {viewTab === 'wardrobe' && (
          <>
            {loading && items.length === 0 ? (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
                <RefreshCw className="w-5 h-5 animate-spin" style={{ color: 'var(--color-ink-3)' }} />
              </div>
            ) : items.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                paddingTop: 80, gap: 12, color: 'var(--color-ink-3, #999)',
              }}>
                <Shirt className="w-12 h-12" style={{ opacity: 0.3 }} />
                <p style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)' }}>衣橱还是空的</p>
                <p style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)' }}>上传衣物照片，或从趋势探索和设计工作室收入衣橱</p>
              </div>
            ) : (
              <>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 'var(--space-4, 16px)',
                }}>
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
                            next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                            return next;
                          });
                        } else {
                          setSelectedItem(item);
                        }
                      }}
                      onFavorite={() => handleToggleFavorite(item)}
                      onDelete={() => handleDelete(item.id)}
                    />
                  ))}
                </div>
                {items.length < total && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-4)' }}>
                    <button
                      type="button"
                      onClick={() => loadItems(page + 1)}
                      disabled={loading}
                      style={{
                        padding: '8px 24px', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)', cursor: 'pointer',
                        color: 'var(--color-ink-2)',
                      }}
                    >
                      {loading ? '加载中...' : '加载更多'}
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
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
                <RefreshCw className="w-5 h-5 animate-spin" style={{ color: 'var(--color-ink-3)' }} />
              </div>
            ) : outfits.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                paddingTop: 80, gap: 12, color: 'var(--color-ink-3, #999)',
              }}>
                <Palette className="w-12 h-12" style={{ opacity: 0.3 }} />
                <p style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)' }}>还没有穿搭方案</p>
                <p style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-ui)' }}>从衣橱中选择衣物创建你的穿搭组合</p>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 'var(--space-4, 16px)',
              }}>
                {outfits.map(outfit => (
                  <OutfitCard key={outfit.id} outfit={outfit} onDelete={() => handleDeleteOutfit(outfit.id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Upload modal */}
      {showUpload && <UploadModal onUpload={handleUpload} onClose={() => setShowUpload(false)} fileRef={fileRef} />}

      {/* Item detail drawer */}
      {selectedItem && (
        <ItemDetailDrawer
          item={selectedItem}
          authToken={authToken}
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

// ── Item Card ────────────────────────────────────────────

function ItemCard({
  item, selecting, selected, onSelect, onDelete,
}: {
  item: WardrobeItem;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  const srcColor = SOURCE_COLORS[item.source_type] || '#999';
  return (
    <div
      onClick={onSelect}
      style={{
        position: 'relative', cursor: 'pointer',
        borderRadius: 'var(--radius-lg, 12px)',
        border: selected ? '2px solid var(--color-accent, #2563eb)' : '1px solid var(--color-border, #e5e5e5)',
        background: 'var(--color-surface, #fff)',
        overflow: 'hidden',
        transition: 'border-color 150ms, box-shadow 150ms',
        boxShadow: selected ? '0 0 0 3px rgba(37,99,235,0.15)' : 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))',
      }}
    >
      {selecting && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 2,
          width: 22, height: 22, borderRadius: '50%',
          border: selected ? 'none' : '2px solid rgba(255,255,255,0.8)',
          background: selected ? 'var(--color-accent, #2563eb)' : 'rgba(0,0,0,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 12, fontWeight: 700,
        }}>
          {selected && '✓'}
        </div>
      )}

      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 2,
        padding: '2px 8px', borderRadius: 'var(--radius-pill, 9999px)',
        background: srcColor, color: '#fff',
        fontSize: 10, fontWeight: 500, fontFamily: 'var(--font-ui)',
      }}>
        {item.source_label}
      </div>

      <div style={{ aspectRatio: '3/4', overflow: 'hidden', background: 'var(--color-surface-3, #f0f0f0)' }}>
        <img
          src={item.thumbnail_url || item.image_url}
          alt={item.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
        />
      </div>

      <div style={{ padding: 'var(--space-3, 12px)' }}>
        <p style={{
          fontSize: 'var(--text-sm, 14px)', fontWeight: 'var(--weight-medium, 500)',
          color: 'var(--color-ink, #1a1a1a)', fontFamily: 'var(--font-ui)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.name || '未命名'}
        </p>
        {item.ai_status === 'pending' && (
          <p style={{ fontSize: 10, color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)', marginTop: 2 }}>
            AI 分析中...
          </p>
        )}
        {item.colors?.length > 0 && (
          <div style={{ display: 'flex', gap: 3, marginTop: 6, flexWrap: 'wrap' }}>
            {item.colors.slice(0, 4).map((c, i) => (
              <span key={i} style={{
                fontSize: 10, padding: '1px 6px',
                borderRadius: 'var(--radius-sm, 4px)',
                background: 'var(--color-surface-3, #eee)',
                color: 'var(--color-ink-2, #666)',
                fontFamily: 'var(--font-ui)',
              }}>
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Outfit Card ──────────────────────────────────────────

function OutfitCard({ outfit, onDelete }: { outfit: Outfit; onDelete: () => void }) {
  const items = outfit.items || [];
  return (
    <div style={{
      borderRadius: 'var(--radius-lg, 12px)',
      border: '1px solid var(--color-border, #e5e5e5)',
      background: 'var(--color-surface, #fff)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(items.length || 1, 4)}, 1fr)`,
        height: 180, overflow: 'hidden',
        background: 'var(--color-surface-3, #f0f0f0)',
      }}>
        {items.slice(0, 4).map(it => (
          <img key={it.id} src={it.thumbnail_url || it.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ))}
        {items.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gridColumn: '1/-1', color: 'var(--color-ink-3)' }}>
            <Palette className="w-8 h-8" style={{ opacity: 0.3 }} />
          </div>
        )}
      </div>
      <div style={{ padding: 'var(--space-3, 12px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium, 500)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>
            {outfit.name || '未命名穿搭'}
          </p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)', marginTop: 2 }}>
            {items.length} 件单品{outfit.occasion ? ` · ${outfit.occasion}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--color-ink-3)' }}
          title="删除"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Outfit Creation Bar ──────────────────────────────────

function OutfitCreationBar({
  selection, onCancel, onCreate,
}: {
  selection: Set<string>;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
      padding: 'var(--space-2) var(--space-5)',
      background: 'var(--color-accent, #2563eb)',
      color: '#fff', flexShrink: 0,
    }}>
      <Sparkles className="w-4 h-4" />
      <span style={{ fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)' }}>
        选择衣物创建穿搭 · 已选 {selection.size} 件
      </span>
      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="穿搭名称"
        style={{
          marginLeft: 'auto', padding: '4px 12px', borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.15)',
          color: '#fff', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)',
          outline: 'none', width: 160,
        }}
      />
      <button
        type="button"
        onClick={() => onCreate(name || '我的穿搭')}
        disabled={selection.size === 0}
        style={{
          padding: '6px 16px', borderRadius: 'var(--radius-md)',
          background: '#fff', color: 'var(--color-accent, #2563eb)',
          border: 'none', cursor: 'pointer',
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium, 500)', fontFamily: 'var(--font-ui)',
          opacity: selection.size === 0 ? 0.5 : 1,
        }}
      >
        创建
      </button>
      <button
        type="button"
        onClick={onCancel}
        style={{
          padding: '6px 12px', borderRadius: 'var(--radius-md)',
          background: 'rgba(255,255,255,0.15)', color: '#fff',
          border: 'none', cursor: 'pointer',
          fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)',
        }}
      >
        取消
      </button>
    </div>
  );
}

// ── Upload Modal ─────────────────────────────────────────

function UploadModal({
  onUpload, onClose, fileRef,
}: {
  onUpload: (files: FileList | File[]) => void;
  onClose: () => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); onUpload(e.dataTransfer.files); }}
        style={{
          width: 440, borderRadius: 'var(--radius-xl, 16px)',
          background: 'var(--color-surface, #fff)',
          boxShadow: 'var(--shadow-xl)',
          padding: 'var(--space-6, 24px)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 'var(--text-lg, 18px)', fontWeight: 'var(--weight-medium, 500)', fontFamily: 'var(--font-ui)', color: 'var(--color-ink)' }}>
            上传衣物
          </h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X className="w-5 h-5" style={{ color: 'var(--color-ink-3)' }} />
          </button>
        </div>
        <div
          style={{
            border: dragging ? '2px dashed var(--color-accent, #2563eb)' : '2px dashed var(--color-border, #e5e5e5)',
            borderRadius: 'var(--radius-lg, 12px)',
            padding: 'var(--space-8, 32px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
            background: dragging ? 'rgba(37,99,235,0.04)' : 'var(--color-surface-2, #f9f9f9)',
            transition: 'all 150ms', cursor: 'pointer',
          }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-8 h-8" style={{ color: 'var(--color-ink-3, #999)' }} />
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)', textAlign: 'center' }}>
            拖放图片到这里，或点击选择文件
          </p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
            支持 JPG、PNG、WebP，上传后自动 AI 识别分类
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={e => e.target.files && onUpload(e.target.files)}
        />
      </div>
    </div>
  );
}

// ── Item Detail Drawer ───────────────────────────────────

function ItemDetailDrawer({
  item, authToken, onClose, onUpdate, onDelete,
}: {
  item: WardrobeItem;
  authToken: string;
  onClose: () => void;
  onUpdate: (item: WardrobeItem) => void;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const [editName, setEditName] = useState(item.name);
  const [editNotes, setEditNotes] = useState(item.notes || '');
  const [editCategory, setEditCategory] = useState(item.category);

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

  const srcColor = SOURCE_COLORS[item.source_type] || '#999';

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: 400, zIndex: 100,
      background: 'var(--color-surface, #fff)',
      borderLeft: '1px solid var(--color-border)',
      boxShadow: 'var(--shadow-xl)',
      display: 'flex', flexDirection: 'column',
      animation: 'drawerSlide var(--duration-slow, 300ms) var(--ease-out, ease-out)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium, 500)', fontFamily: 'var(--font-ui)', color: 'var(--color-ink)' }}>
          衣物详情
        </span>
        <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <X className="w-4 h-4" style={{ color: 'var(--color-ink-3)' }} />
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <img src={item.image_url} alt={item.name} style={{ width: '100%', maxHeight: 360, objectFit: 'cover', background: 'var(--color-surface-3)' }} />

        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <span style={{
            alignSelf: 'flex-start',
            padding: '3px 10px', borderRadius: 'var(--radius-pill)',
            background: srcColor, color: '#fff',
            fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-ui)',
          }}>
            {item.source_label}
          </span>

          <div>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)', display: 'block', marginBottom: 4 }}>名称</label>
            <input
              type="text" value={editName} onChange={e => setEditName(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink)', background: 'var(--color-surface)', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)', display: 'block', marginBottom: 4 }}>分类</label>
            <select
              value={editCategory} onChange={e => setEditCategory(e.target.value as WardrobeCategory)}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink)', background: 'var(--color-surface)', cursor: 'pointer', boxSizing: 'border-box',
              }}
            >
              {CATEGORIES.filter(c => c.key !== 'all').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>

          {item.ai_status === 'completed' && (
            <div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)', marginBottom: 6 }}>AI 识别标签</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {item.style_tags?.map((t, i) => (
                  <span key={i} style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-3)', color: 'var(--color-ink-2)', fontSize: 11, fontFamily: 'var(--font-ui)' }}>{t}</span>
                ))}
                {item.fabric && <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-3)', color: 'var(--color-ink-2)', fontSize: 11, fontFamily: 'var(--font-ui)' }}>{item.fabric}</span>}
                {item.season && <span style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface-3)', color: 'var(--color-ink-2)', fontSize: 11, fontFamily: 'var(--font-ui)' }}>{item.season}</span>}
              </div>
            </div>
          )}
          {item.ai_status === 'pending' && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
              <RefreshCw className="w-3 h-3 inline animate-spin" style={{ marginRight: 4 }} /> AI 正在分析...
            </p>
          )}

          {item.colors?.length > 0 && (
            <div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)', marginBottom: 6 }}>颜色</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {item.colors.map((c, i) => (
                  <span key={i} style={{ padding: '3px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--color-surface-3)', color: 'var(--color-ink-2)', fontSize: 12, fontFamily: 'var(--font-ui)' }}>{c}</span>
                ))}
              </div>
            </div>
          )}

          <div>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)', display: 'block', marginBottom: 4 }}>备注</label>
            <textarea
              value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink)', background: 'var(--color-surface)', outline: 'none', resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', gap: 'var(--space-2)',
        padding: 'var(--space-4) var(--space-5)',
        borderTop: '1px solid var(--color-border)', flexShrink: 0,
      }}>
        <button type="button" onClick={handleSave} style={{
          flex: 1, padding: '10px 0', borderRadius: 'var(--radius-md)',
          background: 'var(--color-ink)', color: '#fff', border: 'none', cursor: 'pointer',
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium, 500)', fontFamily: 'var(--font-ui)',
        }}>
          保存
        </button>
        <button type="button" onClick={onDelete} style={{
          padding: '10px 16px', borderRadius: 'var(--radius-md)',
          background: 'var(--color-surface)', border: '1px solid var(--color-border)',
          color: '#dc2626', cursor: 'pointer',
          fontSize: 'var(--text-sm)', fontFamily: 'var(--font-ui)',
        }}>
          删除
        </button>
      </div>
    </div>
  );
}
