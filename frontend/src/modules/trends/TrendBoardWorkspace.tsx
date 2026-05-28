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
    <span className="flex items-center gap-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-200">
      <Sparkles className="w-2.5 h-2.5" /> 符合你的风格
    </span>
  );
  if (score >= 0.4) return (
    <span className="text-[9px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded-full border border-gray-200">
      ~ 有一定契合度
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
    <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer"
      onClick={() => onClick(trend)}>
      {/* Image collage */}
      <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden">
        {images.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <TrendingUp className="w-12 h-12 text-gray-300" />
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
          className={`absolute top-2 right-2 p-1.5 rounded-full backdrop-blur-sm transition-colors ${
            trend.is_favorite ? 'bg-red-500 text-white' : 'bg-white/80 text-gray-600 hover:text-red-500'
          }`}
        >
          <Heart className="w-3.5 h-3.5" fill={trend.is_favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Body */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900 leading-tight">{trend.name}</h3>
            {trend.name_zh && trend.name_zh !== trend.name && (
              <p className="text-[11px] text-gray-400 mt-0.5">{trend.name_zh}</p>
            )}
          </div>
          {trend.season && (
            <span className="text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200 shrink-0">
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
              <span key={k} className="text-[11px] text-gray-600 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">{k}</span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => onDesignThis(trend)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-[12px] font-medium rounded-xl hover:bg-gray-800 transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" /> 设计这个
          </button>
          {showAddToProject && (
            <button
              type="button"
              onClick={() => onAddToProject(trend)}
              className="flex items-center justify-center gap-1 px-3 py-2 border border-gray-200 text-gray-600 text-[12px] rounded-xl hover:border-gray-400 transition-colors"
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
    <div className="w-96 border-l border-gray-100 flex items-center justify-center bg-white">
      <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
    </div>
  );

  if (!trend) return null;

  const dl = trend.design_language;

  return (
    <div className="w-96 border-l border-gray-100 flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <span className="text-[13px] font-semibold text-gray-900">趋势详情</span>
        <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg">
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
                    className={`w-14 h-14 object-cover rounded-lg cursor-pointer transition-all ${
                      activeImg === i ? 'ring-2 ring-gray-900' : 'opacity-60 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-4 space-y-5">
          {/* Header */}
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-[18px] font-semibold text-gray-900">{trend.name}</h2>
                {trend.name_zh && trend.name_zh !== trend.name && (
                  <p className="text-[13px] text-gray-400">{trend.name_zh}</p>
                )}
              </div>
              {trend.season && (
                <span className="text-[11px] text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200 shrink-0">
                  {trend.season}
                </span>
              )}
            </div>
            {trend.description && (
              <p className="text-[13px] text-gray-600 mt-2 leading-relaxed">{trend.description}</p>
            )}
          </div>

          {/* Color palette */}
          {trend.color_palette.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">色彩体系</p>
              <div className="flex flex-wrap gap-3">
                {trend.color_palette.map((c, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div
                      className="w-8 h-8 rounded-full border border-gray-200 shadow-sm"
                      style={{ background: c.hex || '#E8E4DF' }}
                    />
                    <span className="text-[10px] text-gray-500">{c.name}</span>
                    {c.hex && <span className="text-[9px] text-gray-400 font-mono">{c.hex}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Design language */}
          {(dl.silhouettes?.length || dl.fabrics?.length || dl.details?.length || dl.style_prompt) && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">设计语言</p>
              <div className="space-y-2.5">
                {dl.style_prompt && (
                  <p className="text-[12px] text-gray-600 leading-relaxed">{dl.style_prompt}</p>
                )}
                {dl.silhouettes?.length ? (
                  <div>
                    <span className="text-[10px] text-gray-400">廓形：</span>
                    <span className="text-[12px] text-gray-700">{dl.silhouettes.join('、')}</span>
                  </div>
                ) : null}
                {dl.fabrics?.length ? (
                  <div>
                    <span className="text-[10px] text-gray-400">面料：</span>
                    <span className="text-[12px] text-gray-700">{dl.fabrics.join('、')}</span>
                  </div>
                ) : null}
                {dl.details?.length ? (
                  <div>
                    <span className="text-[10px] text-gray-400">细节：</span>
                    <span className="text-[12px] text-gray-700">{dl.details.join('、')}</span>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Keywords */}
          {trend.keywords.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">关键词</p>
              <div className="flex flex-wrap gap-1.5">
                {trend.keywords.map(k => (
                  <span key={k} className="text-[11px] text-gray-700 bg-gray-50 px-2 py-1 rounded-full border border-gray-200">{k}</span>
                ))}
              </div>
            </div>
          )}

          {/* Add to project (designer) */}
          {activeProjects.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">加入设计项目</p>
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
                      className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-[12px] rounded-lg border transition-colors ${
                        alreadyAdded
                          ? 'border-green-200 bg-green-50 text-green-700 cursor-default'
                          : 'border-gray-200 text-gray-700 hover:border-gray-400'
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
      <div className="shrink-0 px-5 py-4 border-t border-gray-100 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleFav()}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium border transition-colors ${
            trend.is_favorite
              ? 'bg-red-50 border-red-200 text-red-600'
              : 'border-gray-200 text-gray-600 hover:border-red-200 hover:text-red-500'
          }`}
        >
          <Heart className="w-3.5 h-3.5" fill={trend.is_favorite ? 'currentColor' : 'none'} />
          {trend.is_favorite ? '已收藏' : '收藏趋势'}
        </button>
        <button
          type="button"
          onClick={() => onDesignThis(trend)}
          className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-[12px] font-semibold rounded-xl hover:bg-gray-800 transition-colors"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl p-6">
        <h3 className="text-[15px] font-semibold text-gray-900 mb-4">
          将「{trend.name}」加入项目 Brief
        </h3>
        <div className="space-y-3">
          <div>
            <p className="text-[12px] text-gray-500 mb-1.5">选择项目</p>
            {activeProjects.map(proj => (
              <button
                key={proj.id}
                type="button"
                onClick={() => setSelectedProject(proj.id)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-[13px] border mb-1.5 transition-colors ${
                  selectedProject === proj.id
                    ? 'border-gray-900 bg-gray-50 font-semibold'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                {proj.name}
              </button>
            ))}
          </div>
          <div>
            <p className="text-[12px] text-gray-500 mb-1.5">备注（可选）</p>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="如：主要参考色彩体系..."
              className="w-full px-3 py-2 text-[12px] border border-gray-200 rounded-lg outline-none focus:border-gray-400"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-[12px] text-gray-500 hover:text-gray-800">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!selectedProject || saving}
            className="px-4 py-2 bg-gray-900 text-white text-[12px] font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
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
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header */}
        <div className="shrink-0 flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-white flex-wrap">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            {([['recommended', '为你推荐'], ['all', '全部趋势']] as const).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                  tab === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
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
              className="text-[12px] border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-gray-400 bg-white text-gray-700"
            >
              <option value="">全部季节</option>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-44">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearch}
              placeholder="搜索趋势..."
              className="w-full pl-8 pr-3 py-1.5 text-[12px] border border-gray-200 rounded-lg outline-none focus:border-gray-400"
            />
          </div>

          {/* Sync */}
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            同步最新
          </button>
        </div>

        {/* Season label */}
        {currentSeason && (
          <div className="shrink-0 px-6 py-2 text-[11px] text-gray-400">
            当季：{currentSeason} · {trends.length} 条趋势
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-24 text-gray-400 text-[13px]">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" /> 加载中...
            </div>
          )}

          {!loading && trends.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-gray-400">
              <TrendingUp className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-[14px]">暂无趋势数据</p>
              <p className="text-[12px] mt-1">点击「同步最新」从趋势分析系统获取数据</p>
              <button
                type="button"
                onClick={() => void handleSync()}
                disabled={syncing}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-[12px] font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                同步趋势数据
              </button>
            </div>
          )}

          {!loading && trends.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
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
