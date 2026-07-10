import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { PersonalProfile, PersonalStatic, DesignerWorkspace, DesignerProject } from '../types/profile';
import {
  fetchPersonalProfile,
  fetchDesignerWorkspace,
  triggerPersonalAnalyze,
  triggerDesignerAnalyze,
  archiveDesignerProject,
  patchDesignerProject,
} from '../api/profileApi';
import './customize.css';

interface CustomizePageProps {
  user: { email: string; name: string; auth_token: string };
}

// ── Chip / tag display ────────────────────────────────────

function Chip({ label }: { label: string }) {
  return (
    <span className="cp-chip">{label}</span>
  );
}

// ── Tag input (comma-separated pills) ────────────────────

function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    onChange([...value, ...parts]);
    setDraft('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="cp-tag-input">
      {value.map((v, i) => (
        <span key={i} className="cp-tag-pill">
          {v}
          <button
            type="button"
            className="cp-tag-remove"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={value.length === 0 ? placeholder : ''}
        className="cp-tag-input-field"
      />
    </div>
  );
}

// ── Confidence bar ────────────────────────────────────────

function ConfBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="cp-conf-bar-track">
      <div className="cp-conf-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Personal tab ──────────────────────────────────────────

function PersonalTab({ token }: { token: string }) {
  const [profile, setProfile] = useState<PersonalProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [draft, setDraft] = useState<PersonalStatic>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const p = await fetchPersonalProfile(token);
      setProfile(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function startEdit() {
    const s = profile?.static ?? {};
    setDraft({
      body_shape: s.body_shape,
      height_cm: s.height_cm,
      budget_tier: s.budget_tier,
      style_keywords: s.style_keywords ? [...s.style_keywords] : [],
      avoid_elements: s.avoid_elements ? [...s.avoid_elements] : [],
      occasions: s.occasions ? [...s.occasions] : [],
      color_palette: s.color_palette ? [...s.color_palette] : [],
      size: { top: s.size?.top ?? '', bottom: s.size?.bottom ?? '' },
    });
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const staticData: PersonalStatic = {
        ...draft,
        style_keywords: draft.style_keywords?.filter(Boolean),
        avoid_elements: draft.avoid_elements?.filter(Boolean),
        occasions: draft.occasions?.filter(Boolean),
        color_palette: draft.color_palette?.filter(Boolean),
        size: {
          top: draft.size?.top || undefined,
          bottom: draft.size?.bottom || undefined,
        },
      };
      await fetch('/api/design/profile/personal/static', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ static: staticData }),
      }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); });
      await load();
      setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true);
    setError('');
    try {
      const p = await triggerPersonalAnalyze(token);
      setProfile(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'AI 分析失败');
    } finally {
      setAnalyzing(false);
    }
  }

  if (loading) return <div className="cp-loading"><Loader2 size={18} className="cp-spin" /> 加载中…</div>;

  const s = profile?.static ?? {};
  const d = profile?.dynamic;

  return (
    <div className="cp-section-stack">
      {error && <div className="cp-error">{error}</div>}

      {/* Static info card */}
      <div className="cp-card">
        <div className="cp-card-header">
          <span className="cp-section-label">基础档案</span>
          {!editing && (
            <button className="cp-btn-secondary" onClick={startEdit}>编辑基础信息</button>
          )}
        </div>

        {!editing ? (
          <div className="cp-static-grid">
            <StatRow label="体型" value={s.body_shape} />
            <StatRow label="身高" value={s.height_cm != null ? `${s.height_cm} cm` : undefined} />
            <StatRow label="预算档位" value={s.budget_tier} />
            <StatRow label="尺码 上装" value={s.size?.top} />
            <StatRow label="尺码 下装" value={s.size?.bottom} />
            <TagRow label="风格关键词" tags={s.style_keywords} />
            <TagRow label="避免元素" tags={s.avoid_elements} />
            <TagRow label="场合" tags={s.occasions} />
            <TagRow label="色调偏好" tags={s.color_palette} />
          </div>
        ) : (
          <div className="cp-edit-form">
            <div className="cp-form-row">
              <label className="cp-form-label">体型</label>
              <select
                className="cp-select"
                value={draft.body_shape ?? ''}
                onChange={e => setDraft(p => ({ ...p, body_shape: e.target.value as PersonalStatic['body_shape'] || undefined }))}
              >
                <option value="">— 请选择 —</option>
                {(['苹果型', '梨型', '沙漏型', '直筒型', '倒三角型'] as const).map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            <div className="cp-form-row">
              <label className="cp-form-label">身高 (cm)</label>
              <input
                type="number"
                className="cp-input"
                value={draft.height_cm ?? ''}
                min={100}
                max={250}
                onChange={e => setDraft(p => ({ ...p, height_cm: e.target.value ? Number(e.target.value) : undefined }))}
              />
            </div>

            <div className="cp-form-row">
              <label className="cp-form-label">预算档位</label>
              <select
                className="cp-select"
                value={draft.budget_tier ?? ''}
                onChange={e => setDraft(p => ({ ...p, budget_tier: e.target.value as PersonalStatic['budget_tier'] || undefined }))}
              >
                <option value="">— 请选择 —</option>
                {(['亲民', '中端', '中高端', '奢侈'] as const).map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>

            <div className="cp-form-row cp-form-row--top">
              <label className="cp-form-label">风格关键词</label>
              <TagInput
                value={draft.style_keywords ?? []}
                onChange={v => setDraft(p => ({ ...p, style_keywords: v }))}
                placeholder="输入后按 Enter 或逗号"
              />
            </div>

            <div className="cp-form-row cp-form-row--top">
              <label className="cp-form-label">避免元素</label>
              <TagInput
                value={draft.avoid_elements ?? []}
                onChange={v => setDraft(p => ({ ...p, avoid_elements: v }))}
                placeholder="输入后按 Enter 或逗号"
              />
            </div>

            <div className="cp-form-row cp-form-row--top">
              <label className="cp-form-label">场合</label>
              <TagInput
                value={draft.occasions ?? []}
                onChange={v => setDraft(p => ({ ...p, occasions: v }))}
                placeholder="通勤、约会、休闲…"
              />
            </div>

            <div className="cp-form-row cp-form-row--top">
              <label className="cp-form-label">色调偏好</label>
              <TagInput
                value={draft.color_palette ?? []}
                onChange={v => setDraft(p => ({ ...p, color_palette: v }))}
                placeholder="米白、莫兰迪…"
              />
            </div>

            <div className="cp-form-row">
              <label className="cp-form-label">上装尺码</label>
              <input
                type="text"
                className="cp-input cp-input--sm"
                value={draft.size?.top ?? ''}
                placeholder="S / M / 36…"
                onChange={e => setDraft(p => ({ ...p, size: { ...p.size, top: e.target.value } }))}
              />
            </div>

            <div className="cp-form-row">
              <label className="cp-form-label">下装尺码</label>
              <input
                type="text"
                className="cp-input cp-input--sm"
                value={draft.size?.bottom ?? ''}
                placeholder="M / 28…"
                onChange={e => setDraft(p => ({ ...p, size: { ...p.size, bottom: e.target.value } }))}
              />
            </div>

            <div className="cp-form-actions">
              <button className="cp-btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
              <button className="cp-btn-ghost" onClick={() => setEditing(false)} disabled={saving}>取消</button>
            </div>
          </div>
        )}
      </div>

      {/* AI dynamic card */}
      <div className="cp-card">
        <div className="cp-card-header">
          <span className="cp-section-label">AI 动态分析</span>
          <button className="cp-btn-secondary" onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? <><Loader2 size={12} className="cp-spin cp-spin--inline" /> 分析中…</> : '手动触发 AI 分析'}
          </button>
        </div>

        {d ? (
          <>
            {d.inferred_keywords.length > 0 && (
              <div className="cp-dynamic-block">
                <div className="cp-sub-label">推断风格标签</div>
                <div className="cp-kw-list">
                  {d.inferred_keywords.map((kw, i) => (
                    <div key={i} className="cp-kw-row">
                      <span className="cp-kw-tag">{kw.tag}</span>
                      <ConfBar value={kw.confidence} />
                      <span className="cp-kw-pct">{Math.round(kw.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {d.disliked_elements.length > 0 && (
              <div className="cp-dynamic-block">
                <div className="cp-sub-label">不喜欢的元素</div>
                <div className="cp-chip-row">
                  {d.disliked_elements.map((el, i) => <Chip key={i} label={el} />)}
                </div>
              </div>
            )}
            {d.last_analyzed_at && (
              <div className="cp-meta-hint">
                上次分析：{new Date(d.last_analyzed_at).toLocaleString('zh-CN')}
                　·　已分析 {d.sessions_analyzed} 次对话
              </div>
            )}
          </>
        ) : (
          <p className="cp-empty-hint">暂无动态分析数据。点击右侧按钮触发首次分析。</p>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="cp-stat-row">
      <span className="cp-stat-label">{label}</span>
      <span className="cp-stat-value">{value ?? <span className="cp-stat-empty">未设置</span>}</span>
    </div>
  );
}

function TagRow({ label, tags }: { label: string; tags?: string[] }) {
  return (
    <div className="cp-stat-row cp-stat-row--tags">
      <span className="cp-stat-label">{label}</span>
      <div className="cp-chip-row">
        {tags && tags.length > 0
          ? tags.map((t, i) => <Chip key={i} label={t} />)
          : <span className="cp-stat-empty">未设置</span>}
      </div>
    </div>
  );
}

// ── Designer tab ──────────────────────────────────────────

function DesignerTab({ token }: { token: string }) {
  const [workspace, setWorkspace] = useState<DesignerWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const ws = await fetchDesignerWorkspace(token);
      setWorkspace(ws);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function setBusyFor(id: string, on: boolean) {
    setBusy(prev => {
      const next = new Set(prev);
      on ? next.add(id) : next.delete(id);
      return next;
    });
  }

  async function handleArchive(id: string) {
    setBusyFor(id, true);
    try {
      await archiveDesignerProject(token, id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '归档失败');
    } finally {
      setBusyFor(id, false);
    }
  }

  async function handleRestore(id: string) {
    setBusyFor(id, true);
    try {
      await patchDesignerProject(token, id, { status: 'active' });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '恢复失败');
    } finally {
      setBusyFor(id, false);
    }
  }

  async function handleAnalyze(id: string) {
    setBusyFor(id, true);
    try {
      const ws = await triggerDesignerAnalyze(token, id);
      setWorkspace(ws);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '分析失败');
    } finally {
      setBusyFor(id, false);
    }
  }

  if (loading) return <div className="cp-loading"><Loader2 size={18} className="cp-spin" /> 加载中…</div>;

  const active = workspace?.projects.filter(p => p.status === 'active') ?? [];
  const archived = workspace?.projects.filter(p => p.status === 'archived') ?? [];

  return (
    <div className="cp-section-stack">
      {error && <div className="cp-error">{error}</div>}

      {/* Active projects */}
      <div>
        <div className="cp-section-label" style={{ marginBottom: 12 }}>活跃项目</div>
        {active.length === 0 && (
          <p className="cp-empty-hint">暂无活跃项目。</p>
        )}
        <div className="cp-project-list">
          {active.map(proj => (
            <ProjectCard
              key={proj.id}
              project={proj}
              expanded={expanded.has(proj.id)}
              busy={busy.has(proj.id)}
              onToggle={() => toggleExpand(proj.id)}
              onArchive={() => handleArchive(proj.id)}
              onAnalyze={() => handleAnalyze(proj.id)}
            />
          ))}
        </div>
      </div>

      {/* Archived projects */}
      {archived.length > 0 && (
        <div>
          <div className="cp-section-label" style={{ marginBottom: 12 }}>已归档项目</div>
          <div className="cp-archived-list">
            {archived.map(proj => (
              <div key={proj.id} className="cp-archived-row">
                <span className="cp-archived-name">{proj.name}</span>
                <span className="cp-archived-meta">{proj.brief.season ?? '—'}</span>
                <button
                  className="cp-btn-ghost"
                  disabled={busy.has(proj.id)}
                  onClick={() => handleRestore(proj.id)}
                >
                  {busy.has(proj.id) ? '…' : '恢复'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  expanded,
  busy,
  onToggle,
  onArchive,
  onAnalyze,
}: {
  project: DesignerProject;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onArchive: () => void;
  onAnalyze: () => void;
}) {
  const { brief, design_language, dynamic } = project;

  return (
    <div className="cp-card cp-project-card">
      <div className="cp-project-card-header">
        <div className="cp-project-meta">
          <span className="cp-project-name">{project.name}</span>
          {brief.season && <span className="cp-project-season">{brief.season}</span>}
        </div>
        <div className="cp-project-actions">
          <button className="cp-btn-secondary" disabled={busy} onClick={onAnalyze}>
            {busy ? <Loader2 size={12} className="cp-spin cp-spin--inline" /> : '分析'}
          </button>
          <button className="cp-btn-ghost" disabled={busy} onClick={onArchive}>归档</button>
          <button className="cp-btn-icon" onClick={onToggle} aria-label="展开详情">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Style anchors always visible */}
      {brief.style_anchors && brief.style_anchors.length > 0 && (
        <div className="cp-chip-row" style={{ marginTop: 10 }}>
          {brief.style_anchors.map((a, i) => <Chip key={i} label={a} />)}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="cp-project-detail">
          {brief.target_audience && (
            <div className="cp-detail-row">
              <span className="cp-sub-label">目标受众</span>
              <span className="cp-detail-value">{brief.target_audience}</span>
            </div>
          )}
          {design_language.silhouettes && design_language.silhouettes.length > 0 && (
            <div className="cp-detail-row">
              <span className="cp-sub-label">廓形</span>
              <div className="cp-chip-row">
                {design_language.silhouettes.map((s, i) => <Chip key={i} label={s} />)}
              </div>
            </div>
          )}
          {dynamic.design_signatures.length > 0 && (
            <div className="cp-detail-row">
              <span className="cp-sub-label">设计签名</span>
              <div className="cp-kw-list">
                {dynamic.design_signatures.map((sig, i) => (
                  <div key={i} className="cp-kw-row">
                    <span className="cp-kw-tag">{sig.pattern}</span>
                    <ConfBar value={sig.confidence} />
                    <span className="cp-kw-pct">{Math.round(sig.confidence * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {dynamic.last_analyzed_at && (
            <div className="cp-meta-hint" style={{ marginTop: 8 }}>
              上次分析：{new Date(dynamic.last_analyzed_at).toLocaleString('zh-CN')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page root ─────────────────────────────────────────────

type Tab = 'personal' | 'designer';

export default function CustomizePage({ user }: CustomizePageProps) {
  const [tab, setTab] = useState<Tab>('personal');
  const token = user.auth_token;

  return (
    <div className="customize-page">
      <div className="customize-header">
        <SlidersHorizontal className="w-6 h-6" strokeWidth={1.5} />
        <h1 className="customize-title">个性化</h1>
      </div>
      <p className="customize-desc">管理你的穿搭档案与设计师工作区偏好。</p>

      {/* Tab bar */}
      <div className="cp-tabs">
        <button
          className={`cp-tab ${tab === 'personal' ? 'cp-tab--active' : ''}`}
          onClick={() => setTab('personal')}
        >
          个人穿搭档案
        </button>
        <button
          className={`cp-tab ${tab === 'designer' ? 'cp-tab--active' : ''}`}
          onClick={() => setTab('designer')}
        >
          设计师工作区
        </button>
      </div>

      <div className="cp-tab-content">
        {tab === 'personal' && <PersonalTab token={token} />}
        {tab === 'designer' && <DesignerTab token={token} />}
      </div>
    </div>
  );
}
