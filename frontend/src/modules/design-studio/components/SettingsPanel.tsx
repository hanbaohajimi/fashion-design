import { useState, useEffect } from 'react';
import { X, Trash2, RefreshCw, Plus, Archive, Edit3 } from 'lucide-react';
import type { PersonalProfile, DesignerWorkspace, DesignerProject } from '../../../types/profile';
import {
  fetchPersonalProfile,
  fetchDesignerWorkspace,
  triggerPersonalAnalyze,
  triggerDesignerAnalyze,
  archiveDesignerProject,
  patchDesignerProject,
} from '../../../api/profileApi';

interface SettingsPanelProps {
  authToken: string;
  onClose: () => void;
  onEditProject: (project: DesignerProject) => void;
}

type Tab = 'personal' | 'designer';

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full bg-gray-400" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="text-[10px] text-gray-400">{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function SettingsPanel({ authToken, onClose, onEditProject }: SettingsPanelProps) {
  const [tab, setTab] = useState<Tab>('personal');
  const [profile, setProfile] = useState<PersonalProfile | null>(null);
  const [workspace, setWorkspace] = useState<DesignerWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [p, w] = await Promise.all([
        fetchPersonalProfile(authToken),
        fetchDesignerWorkspace(authToken),
      ]);
      setProfile(p);
      setWorkspace(w);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handlePersonalAnalyze = async () => {
    setAnalyzing(true);
    try {
      const p = await triggerPersonalAnalyze(authToken);
      setProfile(p);
    } catch { /* ignore */ }
    setAnalyzing(false);
  };

  const handleDesignerAnalyze = async (projectId: string) => {
    setAnalyzing(true);
    try {
      const w = await triggerDesignerAnalyze(authToken, projectId);
      setWorkspace(w);
    } catch { /* ignore */ }
    setAnalyzing(false);
  };

  const handleArchive = async (projectId: string) => {
    if (!window.confirm('确认归档此项目？归档后不会出现在新建对话的选项中。')) return;
    await archiveDesignerProject(authToken, projectId);
    await load();
  };

  const handleSetActive = async (projectId: string) => {
    if (!workspace) return;
    const w = await patchDesignerProject(authToken, projectId, { status: 'active' });
    setWorkspace(w);
  };

  const activeProjects = (workspace?.projects || []).filter(p => p.status === 'active');
  const archivedProjects = (workspace?.projects || []).filter(p => p.status === 'archived');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
      <div className="dialog-panel w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[color:var(--border-soft)]">
          <div>
            <h2 className="text-[18px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">个性化档案</h2>
            <p className="mt-1 text-[12px] text-[color:var(--text-secondary)]">管理你的风格偏好和设计项目</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost btn-square min-h-10 h-10 w-10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-[color:var(--border-soft)] px-6">
          {(['personal', 'designer'] as Tab[]).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-[color:var(--ink)] text-[color:var(--ink)]'
                  : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
              }`}
            >
              {t === 'personal' ? '个人穿搭档案' : '设计师工作区'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center justify-center py-12 text-[color:var(--text-muted)] text-[13px]">
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
              加载中...
            </div>
          )}

          {!loading && tab === 'personal' && profile && (
            <div className="space-y-6">
              {profile.static && (
                <div>
                  <h3 className="section-label mb-3">基础信息</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {profile.static.body_shape && (
                      <div className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-3 py-2.5">
                        <p className="text-[10px] text-[color:var(--text-muted)]">体型</p>
                        <p className="mt-0.5 text-[13px] font-semibold text-[color:var(--text-primary)]">{profile.static.body_shape}</p>
                      </div>
                    )}
                    {profile.static.budget_tier && (
                      <div className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-3 py-2.5">
                        <p className="text-[10px] text-[color:var(--text-muted)]">预算档位</p>
                        <p className="mt-0.5 text-[13px] font-semibold text-[color:var(--text-primary)]">{profile.static.budget_tier}</p>
                      </div>
                    )}
                  </div>
                  {profile.static.style_keywords?.length ? (
                    <div className="mt-3">
                      <p className="mb-1.5 text-[11px] text-[color:var(--text-muted)]">偏好风格</p>
                      <div className="flex flex-wrap gap-1.5">
                        {profile.static.style_keywords.map(k => (
                          <span key={k} className="chip text-[11px]">{k}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {profile.dynamic?.inferred_keywords?.length ? (
                <div>
                  <h3 className="section-label mb-3">AI 推断偏好</h3>
                  <div className="space-y-2">
                    {profile.dynamic.inferred_keywords.map((kw, i) => (
                      <div key={i} className="flex items-center gap-3 py-1.5">
                        <span className="flex-1 text-[13px] text-[color:var(--text-primary)]">{kw.tag}</span>
                        <ConfidenceBar value={kw.confidence} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {profile.dynamic?.disliked_elements?.length ? (
                <div>
                  <h3 className="section-label mb-3">设计禁区</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.dynamic.disliked_elements.map(el => (
                      <span key={el} className="chip text-[11px] border-red-200 bg-red-50 text-red-700">{el}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={handlePersonalAnalyze}
                  disabled={analyzing}
                  className="btn-secondary text-[12px] font-medium disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
                  手动触发 AI 分析
                </button>
              </div>
            </div>
          )}

          {!loading && tab === 'designer' && (
            <div className="space-y-4">
              {activeProjects.length === 0 && archivedProjects.length === 0 && (
                <div className="py-12 text-center text-[color:var(--text-muted)]">
                  <p className="text-[14px]">还没有任何项目</p>
                  <p className="text-[12px] mt-1">在设计师模式下开始对话时新建项目</p>
                </div>
              )}

              {activeProjects.length > 0 && (
                <div>
                  <h3 className="section-label mb-3">进行中的项目</h3>
                  <div className="space-y-3">
                    {activeProjects.map(proj => (
                      <ProjectCard
                        key={proj.id}
                        project={proj}
                        onEdit={() => onEditProject(proj)}
                        onArchive={() => handleArchive(proj.id)}
                        onAnalyze={() => handleDesignerAnalyze(proj.id)}
                        analyzing={analyzing}
                      />
                    ))}
                  </div>
                </div>
              )}

              {archivedProjects.length > 0 && (
                <div>
                  <h3 className="section-label mb-3">已归档</h3>
                  <div className="space-y-2">
                    {archivedProjects.map(proj => (
                      <div key={proj.id} className="flex items-center gap-3 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-4 py-3 opacity-70">
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-[13px] font-semibold text-[color:var(--text-primary)]">{proj.name}</p>
                          {proj.brief.season && <p className="text-[11px] text-[color:var(--text-muted)]">{proj.brief.season}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSetActive(proj.id)}
                          className="btn-ghost h-9 min-h-9 px-3 text-[11px]"
                        >
                          恢复
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectCard({ project, onEdit, onArchive, onAnalyze, analyzing }: {
  project: DesignerProject;
  onEdit: () => void;
  onArchive: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const allAnchors = [
    ...(project.brief.style_anchors || []),
    ...(project.brief.mood_keywords || []),
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-[color:var(--border-soft)] bg-white">
      <div
        className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-[color:var(--paper)]"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-[color:var(--signal-green)]" />
            <p className="truncate text-[14px] font-semibold text-[color:var(--text-primary)]">{project.name}</p>
            {project.brief.season && (
              <span className="shrink-0 text-[10px] text-[color:var(--text-muted)]">{project.brief.season}</span>
            )}
          </div>
          {allAnchors.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {allAnchors.slice(0, 5).map(a => (
                <span key={a} className="rounded-md bg-[color:var(--paper)] px-2 py-0.5 text-[10px] text-[color:var(--text-secondary)]">{a}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            onClick={onEdit}
            className="btn-ghost btn-square h-9 min-h-9 w-9"
            title="编辑项目"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={analyzing}
            className="btn-ghost btn-square h-9 min-h-9 w-9 disabled:opacity-40"
            title="触发 AI 分析"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onArchive}
            className="btn-ghost btn-square h-9 min-h-9 w-9 hover:text-red-600"
            title="归档项目"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-[color:var(--border-soft)] px-4 pb-4 pt-3">
          {project.brief.target_audience && (
            <p className="text-[12px] text-[color:var(--text-secondary)]">目标客群：{project.brief.target_audience}</p>
          )}
          {project.design_language.silhouettes?.length ? (
            <div>
              <p className="mb-1 text-[11px] text-[color:var(--text-muted)]">惯用廓形</p>
              <div className="flex flex-wrap gap-1">
                {project.design_language.silhouettes.map(s => (
                  <span key={s} className="rounded-md border border-[color:var(--border-soft)] bg-[color:var(--paper)] px-2 py-0.5 text-[11px] text-[color:var(--text-secondary)]">{s}</span>
                ))}
              </div>
            </div>
          ) : null}
          {project.dynamic.design_signatures?.length ? (
            <div>
              <p className="mb-1 text-[11px] text-[color:var(--text-muted)]">AI 总结的设计规律</p>
              <div className="space-y-1.5">
                {project.dynamic.design_signatures.map((sig, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex-1 text-[color:var(--text-primary)]">{sig.pattern}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="h-1 w-10 overflow-hidden rounded-full bg-[color:var(--paper)]">
                        <div className="h-full rounded-full bg-[color:var(--signal-blue)]" style={{ width: `${Math.round(sig.confidence * 100)}%` }} />
                      </div>
                      <span className="text-[10px] text-[color:var(--text-muted)]">{Math.round(sig.confidence * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
