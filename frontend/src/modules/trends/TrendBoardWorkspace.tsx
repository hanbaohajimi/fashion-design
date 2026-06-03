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

  return (
    <div
      onClick={() => onClick(trend)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        cursor: 'pointer',
        transition: 'transform 300ms var(--ease-out), box-shadow 300ms var(--ease-out), border-color 300ms',
        transform: hover ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: hover ? 'var(--shadow-lg)' : 'none',
        borderColor: hover ? 'var(--color-border)' : undefined,
        animation: `cardEnter 300ms var(--ease-out) both`,
        animationDelay: `${Math.min(index * 60, 480)}ms`,
      }}
    >
      {/* Image collage — 220px */}
      <div style={{ position: 'relative', height: 220, overflow: 'hidden', background: 'var(--color-surface-2)' }}>
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
          style={{
            position: 'absolute', top: 10, right: 10,
            width: 32, height: 32,
            borderRadius: 'var(--radius-pill)',
            background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(8px)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: trend.is_favorite ? 'var(--color-gold)' : 'var(--color-ink-2)',
            transform: favAnim ? 'scale(1.4)' : 'scale(1)',
            transition: 'transform 400ms var(--ease-out), color 150ms',
          }}
        >
          <Heart size={13} fill={trend.is_favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: 'var(--space-5)' }}>
        {/* Name */}
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 'var(--weight-light)',
          letterSpacing: 'var(--tracking-tight)',
          color: 'var(--color-ink)',
          lineHeight: 'var(--leading-tight)',
        }}>
          {trend.name}
        </h3>
        {trend.name_zh && trend.name_zh !== trend.name && (
          <p style={{ marginTop: 2, fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
            {trend.name_zh}
          </p>
        )}

        {/* Color swatches */}
        {colors.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 'var(--space-3)' }}>
            {colors.map((c, i) => <ColorSwatch key={i} color={c} />)}
          </div>
        )}

        {/* Keywords */}
        {kws.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
            {kws.map(k => (
              <span key={k} className="tag">{k}</span>
            ))}
          </div>
        )}

        {/* Season badge */}
        {trend.season && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <span style={{
              fontSize: 'var(--text-2xs)',
              letterSpacing: 'var(--tracking-widest)',
              textTransform: 'uppercase',
              color: 'var(--color-ink-3)',
              fontFamily: 'var(--font-ui)',
            }}>
              {trend.season}
            </span>
          </div>
        )}

        {/* Actions */}
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => onDesignThis(trend)}
            className="btn-primary"
            style={{ flex: 1, fontSize: 'var(--text-xs)', height: 36 }}
          >
            <Sparkles size={12} /> 设计这个
          </button>
          {showAddToProject && (
            <button
              type="button"
              onClick={() => onAddToProject(trend)}
              className="btn-icon"
              style={{
                width: 36, height: 36,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
              }}
              title="加入项目 Brief"
            >
              <Bookmark size={14} />
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
    <div style={{
      display: 'flex', width: 384, alignItems: 'center', justifyContent: 'center',
      borderLeft: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      animation: 'drawerSlide var(--duration-slow) var(--ease-out)',
      flexShrink: 0,
    }}>
      <RefreshCw size={18} className="animate-spin" style={{ color: 'var(--color-ink-3)' }} />
    </div>
  );

  if (!trend) return null;

  const dl = trend.design_language;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', width: 384, flexShrink: 0,
      borderLeft: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      animation: 'drawerSlide var(--duration-slow) var(--ease-out)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--color-border)',
        padding: 'var(--space-4) var(--space-5)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>
          趋势详情
        </span>
        <button type="button" onClick={onClose} className="btn-icon">
          <X size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Gallery — horizontal scroll */}
        {trend.image_gallery.length > 0 && (
          <div>
            <img
              src={trend.image_gallery[activeImg]}
              alt=""
              style={{ width: '100%', objectFit: 'cover', maxHeight: 280, background: 'var(--color-surface-3)' }}
            />
            {trend.image_gallery.length > 1 && (
              <div style={{ display: 'flex', gap: 6, padding: 'var(--space-3) var(--space-4)', overflowX: 'auto', scrollbarWidth: 'none' }}>
                {trend.image_gallery.map((img, i) => (
                  <img
                    key={i}
                    src={img}
                    alt=""
                    onClick={() => setActiveImg(i)}
                    style={{
                      width: 56, height: 56, flexShrink: 0,
                      cursor: 'pointer',
                      objectFit: 'cover',
                      borderRadius: 'var(--radius-md)',
                      border: activeImg === i
                        ? '1px solid var(--color-gold)'
                        : '1px solid var(--color-border)',
                      opacity: activeImg === i ? 1 : 0.5,
                      boxShadow: activeImg === i ? 'var(--shadow-gold)' : 'none',
                      transition: 'opacity 150ms, border-color 150ms',
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Header */}
          <div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 26,
              fontWeight: 'var(--weight-light)',
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--color-ink)',
              lineHeight: 'var(--leading-tight)',
            }}>
              {trend.name}
            </h2>
            {trend.name_zh && trend.name_zh !== trend.name && (
              <p style={{ marginTop: 4, fontSize: 'var(--text-sm)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
                {trend.name_zh}
              </p>
            )}
            {trend.season && (
              <span style={{
                display: 'inline-block', marginTop: 6,
                fontSize: 'var(--text-2xs)',
                letterSpacing: 'var(--tracking-widest)',
                textTransform: 'uppercase',
                color: 'var(--color-ink-3)',
                fontFamily: 'var(--font-ui)',
              }}>
                {trend.season}
              </span>
            )}
            {trend.description && (
              <p style={{
                marginTop: 'var(--space-3)',
                fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-loose)',
                color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)',
              }}>
                {trend.description}
              </p>
            )}
          </div>

          {/* Color palette — bar style */}
          {trend.color_palette.length > 0 && (
            <div>
              <p className="subsection-title">色彩体系</p>
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
              <p className="subsection-title">设计语言</p>
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
              <p className="subsection-title">关键词</p>
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
              <p className="subsection-title">加入设计项目</p>
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

      {/* Footer */}
      <div style={{
        display: 'flex', flexShrink: 0, flexDirection: 'column', gap: 'var(--space-2)',
        borderTop: '1px solid var(--color-border)',
        padding: 'var(--space-4) var(--space-5)',
      }}>
        <button
          type="button"
          onClick={() => onDesignThis(trend)}
          className="btn-primary"
          style={{ width: '100%', height: 48, fontSize: 'var(--text-base)', justifyContent: 'center' }}
        >
          <Sparkles size={14} /> 以此趋势开始设计
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
            className="btn-ghost"
            style={{
              width: '100%', height: 36, fontSize: 'var(--text-xs)', justifyContent: 'center',
              color: 'var(--color-ink-2)',
            }}
          >
            <Shirt size={13} /> 收入衣橱
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleFav()}
          className="btn-ghost"
          style={{
            width: '100%', height: 36, fontSize: 'var(--text-xs)', justifyContent: 'center',
            color: trend.is_favorite ? 'var(--color-gold)' : 'var(--color-ink-3)',
          }}
        >
          <Heart size={13} fill={trend.is_favorite ? 'currentColor' : 'none'} />
          {trend.is_favorite ? '已收藏' : '收藏趋势'}
        </button>
      </div>
    </div>
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
    <div style={{
      position: 'fixed', inset: 0,
      zIndex: 'var(--z-modal)' as any,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 16px',
      background: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        width: '100%', maxWidth: 440,
        borderRadius: 'var(--radius-xl)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-xl)',
        padding: 'var(--space-6)',
        animation: 'fadeInUp 400ms var(--ease-out)',
      }}>
        <h3 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 20,
          fontWeight: 'var(--weight-light)',
          color: 'var(--color-ink)',
          marginBottom: 'var(--space-5)',
        }}>
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
                    ? '1px solid var(--color-gold)'
                    : '1px solid var(--color-border)',
                  padding: 'var(--space-3)',
                  textAlign: 'left',
                  fontSize: 'var(--text-sm)',
                  color: selectedProject === proj.id ? 'var(--color-gold)' : 'var(--color-ink-2)',
                  background: selectedProject === proj.id
                    ? 'rgba(66,133,244,0.08)'
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
          search: committedSearch.trim() || undefined,
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
  }, [user.auth_token, tab, selectedSeason, committedSearch]);

  useEffect(() => { void load(); }, [tab, selectedSeason, committedSearch]);

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

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--color-ground)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>

        {/* Hero section */}
        <div style={{
          height: 200, flexShrink: 0,
          position: 'relative',
          background: 'linear-gradient(135deg, var(--color-surface-2) 0%, var(--color-canvas) 100%)',
          display: 'flex', alignItems: 'flex-end',
          padding: 'var(--space-10)',
          overflow: 'hidden',
        }}>
          {/* Subtle texture overlay */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse at 70% 50%, rgba(66,133,244,0.04) 0%, transparent 60%)',
            pointerEvents: 'none',
          }} />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <p style={{
              fontSize: 'var(--text-2xs)',
              letterSpacing: 'var(--tracking-widest)',
              textTransform: 'uppercase',
              color: 'var(--color-gold)',
              fontFamily: 'var(--font-ui)',
              fontWeight: 'var(--weight-medium)',
              marginBottom: 'var(--space-2)',
            }}>
              {currentSeason || '2025 A/W'}
            </p>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 52,
              fontWeight: 'var(--weight-light)',
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--color-ink)',
              lineHeight: 'var(--leading-tight)',
              marginBottom: 'var(--space-2)',
            }}>
              Trend Board
            </h1>
            {trends.length > 0 && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
                {trends.length} 个本季趋势
              </p>
            )}
          </div>
        </div>

        {/* Sticky tab bar */}
        <div style={{
          position: 'sticky', top: 0,
          zIndex: 'var(--z-raised)' as any,
          display: 'flex', flexShrink: 0, alignItems: 'center',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-ground)',
          padding: '0 var(--space-6)',
          height: 52,
          gap: 'var(--space-4)',
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
            {TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center',
                  padding: '0 var(--space-5)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-ui)',
                  fontWeight: tab === t.id ? 'var(--weight-medium)' : 'var(--weight-regular)',
                  color: tab === t.id ? 'var(--color-ink)' : 'var(--color-ink-3)',
                  transition: 'color 150ms',
                  whiteSpace: 'nowrap',
                  gap: 4,
                }}
              >
                {t.label}
                {t.id === 'recommended' && (
                  <span style={{
                    color: tab === t.id ? 'var(--color-gold)' : 'var(--color-ink-3)',
                    fontSize: 11,
                    transition: 'color 150ms',
                  }}>
                    ✦
                  </span>
                )}
                {tab === t.id && (
                  <span style={{
                    position: 'absolute', bottom: 0, left: '15%', right: '15%',
                    height: 2, borderRadius: 'var(--radius-pill)',
                    background: 'var(--color-gold)',
                  }} />
                )}
              </button>
            ))}
          </div>

          {/* Season filter */}
          {seasons.length > 0 && (
            <select
              value={selectedSeason}
              onChange={e => setSelectedSeason(e.target.value)}
              className="input"
              style={{
                width: 'auto', height: 32, minHeight: 32,
                padding: '0 var(--space-3)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
              }}
            >
              <option value="">全部季节</option>
              {seasons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}

          <div style={{ flex: 1 }} />

          {/* Search */}
          <div style={{ position: 'relative', width: 160 }}>
            <Search size={12} style={{
              position: 'absolute', left: 10, top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--color-ink-3)', pointerEvents: 'none',
            }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearch}
              placeholder="搜索趋势..."
              className="input"
              style={{ paddingLeft: 30, height: 32, minHeight: 32, fontSize: 'var(--text-xs)' }}
            />
          </div>

          {/* Sync */}
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="btn-ghost"
            style={{ height: 32, fontSize: 'var(--text-xs)', padding: '0 var(--space-3)' }}
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            同步最新
          </button>
        </div>

        {/* Grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-6)' }}>
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '96px 0', gap: 8, fontSize: 'var(--text-sm)', color: 'var(--color-ink-3)' }}>
              <RefreshCw size={14} className="animate-spin" /> 加载中...
            </div>
          )}

          {!loading && trends.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '96px 0', color: 'var(--color-ink-3)' }}>
              <TrendingUp size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
              <p style={{ fontSize: 'var(--text-base)', fontFamily: 'var(--font-ui)' }}>暂无趋势数据</p>
              <p style={{ fontSize: 'var(--text-sm)', marginTop: 4, color: 'var(--color-ink-3)' }}>点击「同步最新」从趋势分析系统获取数据</p>
              <button
                type="button"
                onClick={() => void handleSync()}
                disabled={syncing}
                className="btn-primary"
                style={{ marginTop: 'var(--space-5)', fontSize: 'var(--text-sm)' }}
              >
                <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
                同步趋势数据
              </button>
            </div>
          )}

          {!loading && trends.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 'var(--space-6)',
            }}>
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
