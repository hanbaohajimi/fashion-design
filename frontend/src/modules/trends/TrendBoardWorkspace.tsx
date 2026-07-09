import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Search, Heart, Sparkles, TrendingUp, RefreshCw, X, ChevronRight, Bookmark, Check, Shirt } from 'lucide-react';
import type { Trend, TrendAnchor } from '../../types/profile';
import {
  fetchTrends,
  fetchTrendSeasons,
  fetchTrendDetail,
  favoriteTrend,
  unfavoriteTrend,
  syncTrends,
  addTrendToProject,
  addToWardrobeFromTrend,
} from '../../api/profileApi';
import { fetchDesignerWorkspace } from '../../api/profileApi';
import type { DesignerWorkspace } from '../../types/profile';
import { useToast } from '../../components/Toast';
import { WorkspaceSkeleton, WorkspaceState } from '../../components/ErrorBoundary';
import './trends.css';

interface TrendBoardProps {
  user: { email: string; name: string; auth_token: string };
  onDesignThis?: (trend: Trend) => void;
}

// ── Color swatch ──────────────────────────────────────────

function ColorSwatch({ color }: { color: { name: string; hex: string } }) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <div
        style={{
          width: 24, height: 12,
          borderRadius: 2,
          background: color.hex || '#3A3A3A',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      />
      {showTip && (
        <div style={{
          position: 'absolute', bottom: '100%', left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 4,
          padding: '3px 6px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          fontSize: 9,
          color: 'var(--color-ink-2)',
          fontFamily: 'var(--font-ui)',
          whiteSpace: 'nowrap',
          zIndex: 10,
        }}>
          {color.name}
        </div>
      )}
    </div>
  );
}

// ── Match badge ───────────────────────────────────────────

function MatchBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  if (score >= 0.7) return (
    <span className="tag-trend" style={{ fontSize: 9, height: 18 }}>
      符合你的风格
    </span>
  );
  if (score >= 0.4) return (
    <span className="tag-ai" style={{ fontSize: 9, height: 18 }}>
      有一定契合度
    </span>
  );
  return null;
}

// ── Trend card ────────────────────────────────────────────

function TrendCard({
  trend,
  index,
  onFavorite,
  onDesignThis,
  onClick,
  showAddToProject,
  onAddToProject,
}: {
  trend: Trend;
  index: number;
  onFavorite: (id: string, val: boolean) => void;
  onDesignThis: (trend: Trend) => void;
  onClick: (trend: Trend) => void;
  showAddToProject: boolean;
  onAddToProject: (trend: Trend) => void;
}) {
  const [hover, setHover] = useState(false);
  const [favAnim, setFavAnim] = useState(false);
  const favTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const images = trend.image_gallery.slice(0, 3);
  const colors = trend.color_palette.slice(0, 4);
  const kws = trend.keywords.slice(0, 3);

  useEffect(() => () => { if (favTimerRef.current) clearTimeout(favTimerRef.current); }, []);

  const handleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    setFavAnim(true);
    if (favTimerRef.current) clearTimeout(favTimerRef.current);
    favTimerRef.current = setTimeout(() => setFavAnim(false), 400);
    onFavorite(trend.id, !trend.is_favorite);
  };

  const excerpt = trend.description?.slice(0, 80) || trend.keywords.slice(0, 2).join(' · ');

  return (
    <div
      onClick={() => onClick(trend)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="trend-card"
      style={{
        animationDelay: `${Math.min(index * 60, 480)}ms`,
        transform: hover ? 'translateY(-2px)' : undefined,
      }}
    >
      <div className="trend-card-img">
        {images.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <TrendingUp size={32} style={{ color: 'var(--color-ink-3)' }} />
          </div>
        )}
        {images.length === 1 && (
          <img src={images[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {images.length === 2 && (
          <div style={{ display: 'flex', height: '100%' }}>
            {images.map((img, i) => (
              <img key={i} src={img} alt="" style={{ width: '50%', height: '100%', objectFit: 'cover' }} />
            ))}
          </div>
        )}
        {images.length >= 3 && (
          <div style={{ display: 'flex', height: '100%' }}>
            <img src={images[0]} alt="" style={{ width: '50%', height: '100%', objectFit: 'cover' }} />
            <div style={{ width: '50%', display: 'flex', flexDirection: 'column' }}>
              <img src={images[1]} alt="" style={{ width: '100%', height: '50%', objectFit: 'cover' }} />
              <img src={images[2]} alt="" style={{ width: '100%', height: '50%', objectFit: 'cover' }} />
            </div>
          </div>
        )}

        {/* Match badge */}
        {trend.match_score != null && trend.match_score > 0 && (
          <div style={{ position: 'absolute', top: 10, left: 10 }}>
            <MatchBadge score={trend.match_score} />
          </div>
        )}

        {/* Fav button */}
        <button
          type="button"
          onClick={handleFav}
          className={`trend-card-fav ${trend.is_favorite ? 'fav' : ''}`}
          style={{ transform: favAnim ? 'scale(1.15)' : undefined }}
        >
          <Heart size={13} strokeWidth={1.5} fill={trend.is_favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="trend-card-body">
        {trend.season && <p className="trend-card-kicker">{trend.season}</p>}
        <h3 className="trend-card-name">{trend.name}</h3>
        {trend.name_zh && trend.name_zh !== trend.name && (
          <p className="trend-card-name-zh">{trend.name_zh}</p>
        )}
        {excerpt && <p className="trend-card-lede">{excerpt}</p>}

        {/* Color swatches */}
        {colors.length > 0 && (
          <div className="trend-card-swatches">
            {colors.map((c, i) => <ColorSwatch key={i} color={c} />)}
          </div>
        )}

        {/* Keywords */}
        {kws.length > 0 && (
          <div className="trend-card-keywords">
            {kws.map(k => (
              <span key={k} className="trend-card-keyword">{k}</span>
            ))}
          </div>
        )}

        <div className="trend-card-actions" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => onDesignThis(trend)} className="trend-card-cta">
            <Sparkles size={12} strokeWidth={1.5} /> 设计这个
          </button>
          {showAddToProject && (
            <button
              type="button"
              onClick={() => onAddToProject(trend)}
              className="trend-card-icon-btn"
              title="加入项目 Brief"
            >
              <Bookmark size={14} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Trend detail panel ─────────────────────────────────────

function TrendDetailPanel({
  trendId,
  authToken,
  workspace,
  onClose,
  onDesignThis,
  onFavoriteChange,
  onAddToProject,
}: {
  trendId: string;
  authToken: string;
  workspace: DesignerWorkspace | null;
  onClose: () => void;
  onDesignThis: (trend: Trend) => void;
  onFavoriteChange: (id: string, val: boolean) => void;
  onAddToProject: (trend: Trend) => void;
}) {
  const { toast } = useToast();
  const [trend, setTrend] = useState<Trend | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImg, setActiveImg] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetchTrendDetail(authToken, trendId)
      .then(r => { setTrend(r.trend); setActiveImg(0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [trendId, authToken]);

  const handleFav = async () => {
    if (!trend) return;
    try {
      if (trend.is_favorite) {
        await unfavoriteTrend(authToken, trend.id);
      } else {
        await favoriteTrend(authToken, trend.id);
      }
      const updated = { ...trend, is_favorite: !trend.is_favorite };
      setTrend(updated);
      onFavoriteChange(trend.id, updated.is_favorite);
    } catch { toast('操作失败', 'error'); }
  };

  const activeProjects = workspace?.projects.filter(p => p.status === 'active') ?? [];

  if (loading) return (
    <div className="trend-drawer-loading">
      <RefreshCw size={18} className="animate-spin" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
    </div>
  );

  if (!trend) return null;

  const dl = trend.design_language;

  return (
    <>
      <div className="trend-drawer-overlay" onClick={onClose} aria-hidden />
      <aside className="trend-drawer" role="dialog" aria-label="趋势详情">
      <div className="trend-drawer-header">
        <div>
          <div className="trend-drawer-kicker">Trend · Detail</div>
          <h2 className="trend-drawer-title">{trend.name}</h2>
        </div>
        <button type="button" onClick={onClose} className="trend-drawer-x" aria-label="关闭">
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>

      <div className="trend-drawer-body">
        {trend.image_gallery.length > 0 && (
          <div>
            <img
              src={trend.image_gallery[activeImg]}
              alt=""
              className="trend-drawer-hero-img"
            />
            {trend.image_gallery.length > 1 && (
              <div className="trend-drawer-thumbs">
                {trend.image_gallery.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt=""
                    onClick={() => setActiveImg(i)}
                    className={`trend-drawer-thumb ${activeImg === i ? 'active' : ''}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="trend-drawer-section">
          <div>
            <h2 className="trend-drawer-headline">{trend.name}</h2>
            {trend.name_zh && trend.name_zh !== trend.name && (
              <p className="trend-card-name-zh" style={{ marginTop: 6 }}>{trend.name_zh}</p>
            )}
            {trend.season && (
              <p className="trend-card-kicker" style={{ marginTop: 10 }}>{trend.season}</p>
            )}
            {trend.description && (
              <p className="trend-drawer-dek" style={{ marginTop: 14 }}>{trend.description}</p>
            )}
          </div>

          {/* Color palette — bar style */}
          {trend.color_palette.length > 0 && (
            <div>
              <p className="trend-subsection-title">色彩体系</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {trend.color_palette.map((c, i) => (
                  <div key={i} style={{
                    height: 48, borderRadius: 'var(--radius-sm)',
                    background: c.hex || '#3A3A3A',
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                    paddingRight: 'var(--space-3)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <span style={{
                      fontSize: 'var(--text-xs)',
                      color: 'rgba(255,255,255,0.7)',
                      fontFamily: 'var(--font-ui)',
                      textShadow: '0 1px 3px rgba(0,0,0,0.6)',
                    }}>
                      {c.name}{c.hex ? ` · ${c.hex}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Design language */}
          {(dl.silhouettes?.length || dl.fabrics?.length || dl.details?.length || dl.style_prompt) && (
            <div>
              <p className="trend-subsection-title">设计语言</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {dl.style_prompt && (
                  <p style={{ fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-loose)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
                    {dl.style_prompt}
                  </p>
                )}
                {[
                  { label: '廓形', val: dl.silhouettes },
                  { label: '面料', val: dl.fabrics },
                  { label: '细节', val: dl.details },
                ].filter(x => x.val?.length).map(x => (
                  <div key={x.label}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
                      {x.label}：
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>
                      {x.val!.join('、')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Keywords */}
          {trend.keywords.length > 0 && (
            <div>
              <p className="trend-subsection-title">关键词</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {trend.keywords.map(k => (
                  <span key={k} className="tag" style={{ height: 28, fontSize: 'var(--text-sm)', padding: '0 var(--space-3)' }}>
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Add to project */}
          {activeProjects.length > 0 && (
            <div>
              <p className="trend-subsection-title">加入设计项目</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {activeProjects.map(proj => {
                  const anchors: TrendAnchor[] = (proj.brief as any)?.trend_anchors ?? [];
                  const alreadyAdded = anchors.some(a => a.trend_id === trend.id);
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => !alreadyAdded && onAddToProject(trend)}
                      disabled={alreadyAdded}
                      style={{
                        display: 'flex', width: '100%', alignItems: 'center',
                        justifyContent: 'space-between', gap: 8,
                        borderRadius: 'var(--radius-md)',
                        border: alreadyAdded
                          ? '1px solid var(--color-success)'
                          : '1px solid var(--color-border)',
                        padding: 'var(--space-2) var(--space-3)',
                        fontSize: 'var(--text-xs)',
                        background: alreadyAdded ? 'rgba(107,158,120,0.1)' : 'transparent',
                        color: alreadyAdded ? 'var(--color-success)' : 'var(--color-ink-2)',
                        cursor: alreadyAdded ? 'default' : 'pointer',
                        transition: 'background 150ms, border-color 150ms',
                        fontFamily: 'var(--font-ui)',
                      }}
                      onMouseEnter={e => !alreadyAdded && ((e.currentTarget as HTMLButtonElement).style.background = 'var(--overlay-hover)')}
                      onMouseLeave={e => !alreadyAdded && ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proj.name}</span>
                      {alreadyAdded
                        ? <Check size={13} style={{ flexShrink: 0, color: 'var(--color-success)' }} />
                        : <ChevronRight size={13} style={{ flexShrink: 0, color: 'var(--color-ink-3)' }} />
                      }
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="trend-drawer-footer">
        <button type="button" onClick={() => onDesignThis(trend)} className="trend-drawer-cta">
          <Sparkles size={14} strokeWidth={1.5} /> 以此趋势开始设计
        </button>
        {trend.image_gallery.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              try {
                await addToWardrobeFromTrend(authToken, trend.image_gallery[activeImg], trend.name_zh || trend.name, trend.id);
                toast('已收入衣橱', 'success');
              } catch { toast('收入衣橱失败', 'error'); }
            }}
            className="trend-drawer-ghost"
          >
            <Shirt size={13} strokeWidth={1.5} /> 收入衣橱
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleFav()}
          className={`trend-drawer-ghost ${trend.is_favorite ? 'fav' : ''}`}
        >
          <Heart size={13} strokeWidth={1.5} fill={trend.is_favorite ? 'currentColor' : 'none'} />
          {trend.is_favorite ? '已收藏' : '收藏趋势'}
        </button>
      </div>
    </aside>
    </>
  );
}

// ── AddToProject modal ─────────────────────────────────────

function AddToProjectModal({
  trend,
  workspace,
  authToken,
  onDone,
  onClose,
}: {
  trend: Trend;
  workspace: DesignerWorkspace | null;
  authToken: string;
  onDone: (workspace: import('../../types/profile').DesignerWorkspace) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [saving, setSaving] = useState(false);

  const activeProjects = workspace?.projects.filter(p => p.status === 'active') ?? [];

  const handleSave = async () => {
    if (!selectedProject) return;
    setSaving(true);
    try {
      const r = await addTrendToProject(authToken, selectedProject, trend.id, note);
      toast(`已将「${trend.name}」加入项目 Brief`, 'success');
      onDone(r.workspace);
    } catch (e: any) {
      toast(e.message || '添加失败', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="trend-modal-overlay" onClick={onClose}>
      <div className="trend-modal-card" onClick={e => e.stopPropagation()}>
        <h3 className="trend-modal-title">
          将「{trend.name}」加入项目 Brief
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div>
            <p style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
              选择项目
            </p>
            {activeProjects.map(proj => (
              <button
                key={proj.id}
                type="button"
                onClick={() => setSelectedProject(proj.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  marginBottom: 6,
                  borderRadius: 'var(--radius-md)',
                  border: selectedProject === proj.id
                    ? '1px solid var(--color-accent)'
                    : '1px solid var(--rule)',
                  padding: 'var(--space-3)',
                  textAlign: 'left',
                  fontSize: 'var(--text-sm)',
                  color: selectedProject === proj.id ? 'var(--color-accent-deep)' : 'var(--color-ink-2)',
                  background: selectedProject === proj.id
                    ? 'var(--color-accent-soft)'
                    : 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-ui)',
                  fontWeight: selectedProject === proj.id ? 'var(--weight-medium)' : 'var(--weight-regular)',
                  transition: 'all 150ms',
                }}
              >
                {proj.name}
              </button>
            ))}
          </div>

          <div>
            <p style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
              备注（可选）
            </p>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="如：主要参考色彩体系..."
              className="input"
              style={{ fontSize: 'var(--text-sm)' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-6)' }}>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: 'var(--text-sm)' }}>
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!selectedProject || saving}
            className="btn-primary"
            style={{ fontSize: 'var(--text-sm)' }}
          >
            {saving ? '保存中...' : '确认添加'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────

export default function TrendBoardWorkspace({ user, onDesignThis }: TrendBoardProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'recommended' | 'all'>('recommended');
  const [seasons, setSeasons] = useState<string[]>([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [trends, setTrends] = useState<Trend[]>([]);
  const [currentSeason, setCurrentSeason] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<DesignerWorkspace | null>(null);
  const [addToProjectTrend, setAddToProjectTrend] = useState<Trend | null>(null);

  const isDesigner = workspace?.projects.some(p => p.status === 'active') ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [trendsRes, seasonsRes, wsRes] = await Promise.all([
        fetchTrends(user.auth_token, {
          season: selectedSeason || undefined,
          recommended: tab === 'recommended',
          search: committedSearch.trim() || undefined,
        }),
        fetchTrendSeasons(user.auth_token),
        fetchDesignerWorkspace(user.auth_token),
      ]);
      setTrends(trendsRes.trends);
      setCurrentSeason(trendsRes.season);
      setSeasons(seasonsRes.seasons);
      setWorkspace(wsRes);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '无法加载趋势数据');
    } finally {
      setLoading(false);
    }
  }, [user.auth_token, tab, selectedSeason, committedSearch]);

  useEffect(() => { void load(); }, [load]);

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') setCommittedSearch(search);
  };

  const handleFavorite = async (id: string, val: boolean) => {
    try {
      if (val) await favoriteTrend(user.auth_token, id);
      else await unfavoriteTrend(user.auth_token, id);
      setTrends(prev => prev.map(t => t.id === id ? { ...t, is_favorite: val } : t));
    } catch { toast('操作失败', 'error'); }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await syncTrends(user.auth_token);
      toast(`同步完成，${r.synced} 条趋势已更新`, 'success');
      void load();
    } catch { toast('同步失败', 'error'); }
    setSyncing(false);
  };

  const handleDesignThis = (trend: Trend) => {
    onDesignThis?.(trend);
    toast(`正在以「${trend.name}」开始设计...`, 'info');
  };

  const handleAddToProject = (trend: Trend) => {
    setAddToProjectTrend(trend);
  };

  const TABS = [
    { id: 'recommended' as const, label: '为你推荐', suffix: ' ✦' },
    { id: 'all' as const, label: '全部趋势', suffix: '' },
  ];
  const hasActiveFilters = Boolean(selectedSeason || committedSearch.trim());

  const clearFilters = () => {
    setSelectedSeason('');
    setSearch('');
    setCommittedSearch('');
  };

  return (
    <div className="trend-board-shell">
      <div className="trend-board-main">

        <header className="trend-hero">
          <div>
            <p className="trend-hero-kicker">{currentSeason || '2025 A/W'} · Season</p>
            <h1 className="trend-hero-title">Trend Board</h1>
            <p className="trend-hero-lede">
              &ldquo;Every season writes itself in silhouette, fabric, and the quiet grammar of color.&rdquo;
            </p>
            {trends.length > 0 && (
              <p className="trend-hero-meta">{trends.length} trends in this issue</p>
            )}
          </div>
        </header>

        <div className="trend-controls">
          <div className="trend-controls-tabs">
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`trend-controls-tab ${tab === t.id ? 'active' : ''}`}
              >
                {t.label}{t.suffix}
              </button>
            ))}
          </div>

          {seasons.length > 0 && (
            <select
              value={selectedSeason}
              onChange={e => setSelectedSeason(e.target.value)}
              className="trend-controls-select"
            >
              <option value="">全部季节</option>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          <div style={{ flex: 1 }} />

          <div className="trend-controls-search">
            <Search size={12} strokeWidth={1.5} style={{
              position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-ink-3)', pointerEvents: 'none',
            }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearch}
              placeholder="搜索趋势…"
            />
          </div>

          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="trend-controls-sync"
          >
            <RefreshCw size={12} strokeWidth={1.5} className={syncing ? 'animate-spin' : ''} />
            同步最新
          </button>
        </div>

        <div className="trend-grid-wrap">
          {loading && trends.length === 0 && (
            <WorkspaceSkeleton count={8} label="正在加载趋势" />
          )}

          {!loading && loadError && trends.length === 0 && (
            <WorkspaceState
              kind="error"
              eyebrow="趋势探索"
              title="趋势数据没有加载成功"
              description={loadError}
              action={{
                label: '重新加载',
                icon: <RefreshCw size={14} strokeWidth={1.5} />,
                onClick: () => void load(),
              }}
              secondaryAction={{
                label: '同步最新数据',
                icon: <RefreshCw size={14} strokeWidth={1.5} />,
                onClick: () => void handleSync(),
                disabled: syncing,
              }}
            />
          )}

          {!loading && !loadError && trends.length === 0 && (
            <WorkspaceState
              eyebrow="趋势探索"
              icon={<TrendingUp size={21} strokeWidth={1.5} />}
              title={hasActiveFilters ? '没有符合当前条件的趋势' : '趋势板还没有内容'}
              description={hasActiveFilters
                ? '清除季节和搜索条件，查看完整趋势集合。'
                : '从趋势分析服务同步最新报告后，可以收藏趋势或直接进入设计。'}
              action={hasActiveFilters
                ? { label: '清除筛选', onClick: clearFilters }
                : {
                    label: syncing ? '正在同步' : '同步趋势数据',
                    icon: <RefreshCw size={14} strokeWidth={1.5} className={syncing ? 'animate-spin' : ''} />,
                    onClick: () => void handleSync(),
                    disabled: syncing,
                  }}
            />
          )}

          {trends.length > 0 && (
            <div className="trend-grid">
              {trends.map((trend, i) => (
                <TrendCard
                  key={trend.id}
                  trend={trend}
                  index={i}
                  onFavorite={(id, val) => void handleFavorite(id, val)}
                  onDesignThis={handleDesignThis}
                  onClick={t => setDetailId(t.id)}
                  showAddToProject={isDesigner}
                  onAddToProject={handleAddToProject}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {detailId && (
        <TrendDetailPanel
          trendId={detailId}
          authToken={user.auth_token}
          workspace={workspace}
          onClose={() => setDetailId(null)}
          onDesignThis={handleDesignThis}
          onFavoriteChange={(id, val) => setTrends(prev => prev.map(t => t.id === id ? { ...t, is_favorite: val } : t))}
          onAddToProject={handleAddToProject}
        />
      )}

      {/* AddToProject modal */}
      {addToProjectTrend && (
        <AddToProjectModal
          trend={addToProjectTrend}
          workspace={workspace}
          authToken={user.auth_token}
          onDone={ws => { setWorkspace(ws); setAddToProjectTrend(null); }}
          onClose={() => setAddToProjectTrend(null)}
        />
      )}
    </div>
  );
}
