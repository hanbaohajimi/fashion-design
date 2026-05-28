import { useState, useEffect, useCallback } from 'react';
import { Search, Heart, Sparkles, TrendingUp, RefreshCw, X, ChevronRight, Bookmark, Check } from 'lucide-react';
import type { Trend, TrendAnchor } from '../../types/profile';
import {
  fetchTrends,
  fetchTrendSeasons,
  fetchTrendDetail,
  favoriteTrend,
  unfavoriteTrend,
  syncTrends,
  addTrendToProject,
} from '../../api/profileApi';
import { fetchDesignerWorkspace } from '../../api/profileApi';
import type { DesignerWorkspace } from '../../types/profile';
import { useToast } from '../../components/Toast';

interface TrendBoardProps {
  user: { email: string; name: string; auth_token: string };
  onDesignThis?: (trend: Trend) => void;
}

// ── Color swatch ──────────────────────────────────────────

function ColorSwatch({ color }: { color: { name: string; hex: string } }) {
  const bg = color.hex || '#E8E4DF';
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="w-7 h-7 rounded-full border border-white/50 shadow-sm"
        style={{ background: bg }}
        title={color.name}
      />
    </div>
  );
}

// ── Match badge ───────────────────────────────────────────

function MatchBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  if (score >= 0.7) return (
    <span className="flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
      <Sparkles className="w-2.5 h-2.5" /> 符合你的风格
    </span>
  );
  if (score >= 0.4) return (
    <span className="rounded-full border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-1.5 py-0.5 text-[9px] text-[color:var(--text-secondary)]">
      有一定契合度
    </span>
  );
  return null;
}

// ── Trend card ────────────────────────────────────────────

function TrendCard({
  trend,
  onFavorite,
  onDesignThis,
  onClick,
  showAddToProject,
  onAddToProject,
}: {
  trend: Trend;
  onFavorite: (id: string, val: boolean) => void;
  onDesignThis: (trend: Trend) => void;
  onClick: (trend: Trend) => void;
  showAddToProject: boolean;
  onAddToProject: (trend: Trend) => void;
}) {
  const images = trend.image_gallery.slice(0, 3);
  const colors = trend.color_palette.slice(0, 4);
  const kws = trend.keywords.slice(0, 4);

  return (
    <div className="group cursor-pointer overflow-hidden rounded-3xl border border-[color:var(--border-soft)] bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-[color:var(--border-strong)] hover:shadow-[0_18px_42px_rgba(16,17,20,0.12)]"
      onClick={() => onClick(trend)}>
      {/* Image collage */}
      <div className="relative aspect-[4/3] overflow-hidden bg-[color:var(--paper)]">
        {images.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <TrendingUp className="w-12 h-12 text-[color:var(--text-dim)]" />
          </div>
        )}
        {images.length === 1 && (
          <img src={images[0]} alt="" className="w-full h-full object-cover" />
        )}
        {images.length === 2 && (
          <div className="flex h-full">
            {images.map((img, i) => (
              <img key={i} src={img} alt="" className="w-1/2 h-full object-cover" />
            ))}
          </div>
        )}
        {images.length >= 3 && (
          <div className="flex h-full">
            <img src={images[0]} alt="" className="w-1/2 h-full object-cover" />
            <div className="w-1/2 flex flex-col">
              <img src={images[1]} alt="" className="w-full h-1/2 object-cover" />
              <img src={images[2]} alt="" className="w-full h-1/2 object-cover" />
            </div>
          </div>
        )}
        {/* Match badge */}
        {trend.match_score != null && trend.match_score > 0 && (
          <div className="absolute top-2 left-2">
            <MatchBadge score={trend.match_score} />
          </div>
        )}
        {/* Fav button */}
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onFavorite(trend.id, !trend.is_favorite); }}
          className={`absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
            trend.is_favorite ? 'bg-red-500 text-white' : 'bg-white/84 text-[color:var(--text-secondary)] hover:text-red-500'
          }`}
        >
          <Heart className="w-3.5 h-3.5" fill={trend.is_favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Body */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold leading-tight text-[color:var(--text-primary)]">{trend.name}</h3>
            {trend.name_zh && trend.name_zh !== trend.name && (
              <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">{trend.name_zh}</p>
            )}
          </div>
          {trend.season && (
            <span className="shrink-0 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-2 py-0.5 text-[10px] text-[color:var(--text-muted)]">
              {trend.season}
            </span>
          )}
        </div>

        {/* Color palette */}
        {colors.length > 0 && (
          <div className="flex items-center gap-1.5 my-3">
            {colors.map((c, i) => <ColorSwatch key={i} color={c} />)}
          </div>
        )}

        {/* Keywords */}
        {kws.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {kws.map(k => (
              <span key={k} className="rounded-full border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-2 py-0.5 text-[11px] text-[color:var(--text-secondary)]">{k}</span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => onDesignThis(trend)}
            className="btn-primary flex-1 text-[12px] font-semibold"
          >
            <Sparkles className="w-3.5 h-3.5" /> 设计这个
          </button>
          {showAddToProject && (
            <button
              type="button"
              onClick={() => onAddToProject(trend)}
              className="btn-secondary px-3 text-[12px]"
              title="加入项目 Brief"
            >
              <Bookmark className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Trend detail panel ────────────────────────────────────

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
    <div className="flex w-96 items-center justify-center border-l border-[color:var(--border-soft)] bg-white">
      <RefreshCw className="w-5 h-5 animate-spin text-[color:var(--text-muted)]" />
    </div>
  );

  if (!trend) return null;

  const dl = trend.design_language;

  return (
    <div className="flex h-full w-96 flex-col border-l border-[color:var(--border-soft)] bg-white">
      <div className="flex items-center justify-between border-b border-[color:var(--border-soft)] px-5 py-3">
        <span className="text-[13px] font-semibold text-[color:var(--text-primary)]">趋势详情</span>
        <button type="button" onClick={onClose} className="btn-ghost btn-square h-9 min-h-9 w-9">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Gallery */}
        {trend.image_gallery.length > 0 && (
          <div>
            <img
              src={trend.image_gallery[activeImg]}
              alt=""
              className="w-full object-cover"
              style={{ maxHeight: 280 }}
            />
            {trend.image_gallery.length > 1 && (
              <div className="flex gap-1.5 px-4 py-2">
                {trend.image_gallery.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt=""
                    onClick={() => setActiveImg(i)}
                className={`h-14 w-14 cursor-pointer rounded-xl object-cover transition-all ${
                      activeImg === i ? 'ring-2 ring-[color:var(--ink)]' : 'opacity-60 hover:opacity-100'
                    }`}
                />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-5 px-5 py-4">
          {/* Header */}
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-[18px] font-semibold text-[color:var(--text-primary)]">{trend.name}</h2>
                {trend.name_zh && trend.name_zh !== trend.name && (
                  <p className="text-[13px] text-[color:var(--text-muted)]">{trend.name_zh}</p>
                )}
              </div>
              {trend.season && (
                <span className="shrink-0 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-2 py-0.5 text-[11px] text-[color:var(--text-muted)]">
                  {trend.season}
                </span>
              )}
            </div>
            {trend.description && (
              <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">{trend.description}</p>
            )}
          </div>

          {/* Color palette */}
          {trend.color_palette.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">色彩体系</p>
              <div className="flex flex-wrap gap-3">
                {trend.color_palette.map((c, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div
                      className="h-8 w-8 rounded-full border border-[color:var(--border-soft)] shadow-sm"
                      style={{ background: c.hex || '#E8E4DF' }}
                    />
                    <span className="text-[10px] text-[color:var(--text-secondary)]">{c.name}</span>
                    {c.hex && <span className="font-mono text-[9px] text-[color:var(--text-muted)]">{c.hex}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Design language */}
          {(dl.silhouettes?.length || dl.fabrics?.length || dl.details?.length || dl.style_prompt) && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">设计语言</p>
              <div className="space-y-2.5">
                {dl.style_prompt && (
                  <p className="text-[12px] leading-relaxed text-[color:var(--text-secondary)]">{dl.style_prompt}</p>
                )}
                {dl.silhouettes?.length ? (
                  <div>
                    <span className="text-[10px] text-[color:var(--text-muted)]">廓形：</span>
                    <span className="text-[12px] text-[color:var(--text-primary)]">{dl.silhouettes.join('、')}</span>
                  </div>
                ) : null}
                {dl.fabrics?.length ? (
                  <div>
                    <span className="text-[10px] text-[color:var(--text-muted)]">面料：</span>
                    <span className="text-[12px] text-[color:var(--text-primary)]">{dl.fabrics.join('、')}</span>
                  </div>
                ) : null}
                {dl.details?.length ? (
                  <div>
                    <span className="text-[10px] text-[color:var(--text-muted)]">细节：</span>
                    <span className="text-[12px] text-[color:var(--text-primary)]">{dl.details.join('、')}</span>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Keywords */}
          {trend.keywords.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">关键词</p>
              <div className="flex flex-wrap gap-1.5">
                {trend.keywords.map(k => (
                  <span key={k} className="rounded-full border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-2 py-1 text-[11px] text-[color:var(--text-secondary)]">{k}</span>
                ))}
              </div>
            </div>
          )}

          {/* Add to project (designer) */}
          {activeProjects.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">加入设计项目</p>
              <div className="space-y-1.5">
                {activeProjects.map(proj => {
                  const anchors: TrendAnchor[] = (proj.brief as any)?.trend_anchors ?? [];
                  const alreadyAdded = anchors.some(a => a.trend_id === trend.id);
                  return (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => !alreadyAdded && onAddToProject(trend)}
                      disabled={alreadyAdded}
                      className={`flex w-full items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-[12px] transition-colors ${
                        alreadyAdded
                          ? 'cursor-default border-green-200 bg-green-50 text-green-700'
                          : 'border-[color:var(--border-soft)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)]'
                      }`}
                    >
                      <span className="truncate">{proj.name}</span>
                      {alreadyAdded
                        ? <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      }
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center gap-2 border-t border-[color:var(--border-soft)] px-5 py-4">
        <button
          type="button"
          onClick={() => void handleFav()}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-medium transition-colors ${
            trend.is_favorite
              ? 'border-red-200 bg-red-50 text-red-600'
              : 'border-[color:var(--border-soft)] text-[color:var(--text-secondary)] hover:border-red-200 hover:text-red-500'
          }`}
        >
          <Heart className="w-3.5 h-3.5" fill={trend.is_favorite ? 'currentColor' : 'none'} />
          {trend.is_favorite ? '已收藏' : '收藏趋势'}
        </button>
        <button
          type="button"
          onClick={() => onDesignThis(trend)}
          className="btn-primary flex-1 text-[12px] font-semibold"
        >
          <Sparkles className="w-3.5 h-3.5" /> 以此趋势开始设计
        </button>
      </div>
    </div>
  );
}

// ── AddToProject modal ────────────────────────────────────

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <div className="dialog-panel w-full max-w-md p-6">
        <h3 className="mb-4 text-[15px] font-semibold text-[color:var(--text-primary)]">
          将「{trend.name}」加入项目 Brief
        </h3>
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-[12px] text-[color:var(--text-secondary)]">选择项目</p>
            {activeProjects.map(proj => (
              <button
                key={proj.id}
                type="button"
                onClick={() => setSelectedProject(proj.id)}
                className={`mb-1.5 w-full rounded-2xl border px-3 py-2.5 text-left text-[13px] transition-colors ${
                  selectedProject === proj.id
                    ? 'border-[color:var(--ink)] bg-[color:var(--paper)] font-semibold'
                    : 'border-[color:var(--border-soft)] hover:border-[color:var(--border-strong)]'
                }`}
              >
                {proj.name}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-1.5 text-[12px] text-[color:var(--text-secondary)]">备注（可选）</p>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="如：主要参考色彩体系..."
              className="input-shell text-[12px]"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="btn-ghost px-4 text-[12px]">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!selectedProject || saving}
            className="btn-primary px-4 text-[12px] font-semibold disabled:opacity-50"
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
  const [trends, setTrends] = useState<Trend[]>([]);
  const [currentSeason, setCurrentSeason] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<DesignerWorkspace | null>(null);
  const [addToProjectTrend, setAddToProjectTrend] = useState<Trend | null>(null);

  const isDesigner = workspace?.projects.some(p => p.status === 'active') ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [trendsRes, seasonsRes, wsRes] = await Promise.all([
        fetchTrends(user.auth_token, {
          season: selectedSeason || undefined,
          recommended: tab === 'recommended',
          search: search.trim() || undefined,
        }),
        fetchTrendSeasons(user.auth_token),
        fetchDesignerWorkspace(user.auth_token),
      ]);
      setTrends(trendsRes.trends);
      setCurrentSeason(trendsRes.season);
      setSeasons(seasonsRes.seasons);
      setWorkspace(wsRes);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user.auth_token, tab, selectedSeason, search]);

  useEffect(() => { void load(); }, [tab, selectedSeason]);

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void load();
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

  return (
    <div className="flex h-full overflow-hidden bg-[color:var(--bg)]">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[color:var(--border-soft)] bg-white px-6 py-3">
          <div className="flex items-center gap-1">
            {([['recommended', '为你推荐'], ['all', '全部趋势']] as const).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-xl px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  tab === t ? 'bg-[color:var(--ink)] text-white' : 'text-[color:var(--text-secondary)] hover:bg-[color:var(--paper)] hover:text-[color:var(--text-primary)]'
                }`}
              >
                {t === 'recommended' && <Sparkles className="w-3 h-3 inline mr-1 opacity-70" />}
                {label}
              </button>
            ))}
          </div>

          {/* Season selector */}
          {seasons.length > 0 && (
            <select
              value={selectedSeason}
              onChange={e => setSelectedSeason(e.target.value)}
              className="input-shell min-h-0 w-auto rounded-xl px-2.5 py-1.5 text-[12px]"
            >
              <option value="">全部季节</option>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-44">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearch}
              placeholder="搜索趋势..."
              className="input-shell min-h-0 py-1.5 pl-8 pr-3 text-[12px]"
            />
          </div>

          {/* Sync */}
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="btn-secondary min-h-0 px-3 py-1.5 text-[12px] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            同步最新
          </button>
        </div>

        {/* Season label */}
        {currentSeason && (
          <div className="shrink-0 px-6 py-2 text-[11px] text-[color:var(--text-muted)]">
            当季：{currentSeason} · {trends.length} 条趋势
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-24 text-[13px] text-[color:var(--text-muted)]">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> 加载中...
            </div>
          )}

          {!loading && trends.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-[color:var(--text-muted)]">
              <TrendingUp className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-[14px]">暂无趋势数据</p>
              <p className="text-[12px] mt-1">点击「同步最新」从趋势分析系统获取数据</p>
              <button
                type="button"
                onClick={() => void handleSync()}
                disabled={syncing}
                className="btn-primary mt-4 text-[12px] font-semibold disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                同步趋势数据
              </button>
            </div>
          )}

          {!loading && trends.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {trends.map(trend => (
                <TrendCard
                  key={trend.id}
                  trend={trend}
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

      {/* Detail panel */}
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
