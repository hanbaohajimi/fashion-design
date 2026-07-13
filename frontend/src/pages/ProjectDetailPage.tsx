import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Edit2, FileText, BookOpen, Image, Clock, Upload, Trash2, Eye, EyeOff } from 'lucide-react';
import {
  createDesign,
  deleteProjectAsset,
  fetchProject,
  fetchProjectAssets,
  patchProject,
  patchProjectAsset,
  uploadProjectAsset,
  type DesignThread,
  type Project,
  type ProjectAsset,
} from '../api/designsApi';
import { useToast } from '../components/Toast';
import { formatDate } from '../utils/date';
import './project-detail.css';

interface ProjectDetailPageProps {
  user: { email: string; name: string; auth_token: string };
}

function RightPanel({
  project,
  authToken,
  onSave,
}: {
  project: Project;
  authToken: string;
  onSave: (updated: Partial<Project>) => void;
}) {
  const { toast } = useToast();
  const [editingBrief, setEditingBrief] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [briefVal, setBriefVal] = useState(project.description || '');
  const [rulesVal, setRulesVal] = useState(project.instructions || '');
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setAssetsLoading(true);
    void fetchProjectAssets(authToken, project.id)
      .then(items => { if (!cancelled) setAssets(items); })
      .catch(() => { if (!cancelled) toast('项目资料加载失败', 'error'); })
      .finally(() => { if (!cancelled) setAssetsLoading(false); });
    return () => { cancelled = true; };
  }, [authToken, project.id, toast]);

  const saveBrief = async () => {
    await patchProject(authToken, project.id, { description: briefVal });
    onSave({ description: briefVal });
    setEditingBrief(false);
  };
  const saveRules = async () => {
    await patchProject(authToken, project.id, { instructions: rulesVal });
    onSave({ instructions: rulesVal });
    setEditingRules(false);
  };

  const handleAssetUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map(file => uploadProjectAsset(authToken, project.id, file)));
      setAssets(current => [...uploaded, ...current]);
      toast(`已添加 ${uploaded.length} 份项目资料`, 'success');
    } catch {
      toast('部分资料上传失败，请检查格式与大小', 'error');
    } finally {
      setUploading(false);
    }
  };

  const toggleAsset = async (asset: ProjectAsset) => {
    try {
      const updated = await patchProjectAsset(authToken, project.id, asset.id, { enabled: !asset.enabled });
      setAssets(current => current.map(item => item.id === updated.id ? updated : item));
    } catch {
      toast('资料状态更新失败', 'error');
    }
  };

  const removeAsset = async (asset: ProjectAsset) => {
    try {
      await deleteProjectAsset(authToken, project.id, asset.id);
      setAssets(current => current.filter(item => item.id !== asset.id));
      toast('项目资料已移除', 'success');
    } catch {
      toast('项目资料移除失败', 'error');
    }
  };

  return (
    <aside className="project-detail-right">
      {/* Project Brief */}
      <div className="project-panel-section">
        <div className="project-panel-section-header">
          <FileText className="w-3.5 h-3.5" strokeWidth={1.5} />
          <span>项目简介</span>
          <button type="button" className="project-panel-edit-btn" onClick={() => setEditingBrief(v => !v)}>
            <Edit2 className="w-3 h-3" strokeWidth={1.5} />
          </button>
        </div>
        {editingBrief ? (
          <div className="project-panel-edit">
            <textarea
              className="project-panel-textarea"
              value={briefVal}
              onChange={e => setBriefVal(e.target.value)}
              placeholder="项目背景、目标受众、季节、风格方向..."
              rows={5}
              autoFocus
            />
            <div className="project-panel-edit-actions">
              <button type="button" onClick={() => setEditingBrief(false)} className="project-panel-btn-cancel">取消</button>
              <button type="button" onClick={() => void saveBrief()} className="project-panel-btn-save">保存</button>
            </div>
          </div>
        ) : (
          <p className="project-panel-text">
            {project.description || <span className="project-panel-placeholder">点击编辑添加项目简介...</span>}
          </p>
        )}
      </div>

      {/* Design Rules */}
      <div className="project-panel-section">
        <div className="project-panel-section-header">
          <BookOpen className="w-3.5 h-3.5" strokeWidth={1.5} />
          <span>设计规则</span>
          <button type="button" className="project-panel-edit-btn" onClick={() => setEditingRules(v => !v)}>
            <Edit2 className="w-3 h-3" strokeWidth={1.5} />
          </button>
        </div>
        {editingRules ? (
          <div className="project-panel-edit">
            <textarea
              className="project-panel-textarea"
              value={rulesVal}
              onChange={e => setRulesVal(e.target.value)}
              placeholder="设计规范、禁忌方向、风格限制..."
              rows={5}
              autoFocus
            />
            <div className="project-panel-edit-actions">
              <button type="button" onClick={() => setEditingRules(false)} className="project-panel-btn-cancel">取消</button>
              <button type="button" onClick={() => void saveRules()} className="project-panel-btn-save">保存</button>
            </div>
          </div>
        ) : (
          <p className="project-panel-text">
            {project.instructions || <span className="project-panel-placeholder">点击编辑添加设计规则...</span>}
          </p>
        )}
      </div>

      {/* Project knowledge */}
      <div className="project-panel-section">
        <div className="project-panel-section-header">
          <Image className="w-3.5 h-3.5" strokeWidth={1.5} />
          <span>项目知识</span>
          <button
            type="button"
            className="project-panel-edit-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            title="上传项目资料"
          >
            <Upload className="w-3 h-3" strokeWidth={1.5} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.json,.csv,.tsv"
          onChange={event => void handleAssetUpload(event)}
        />
        <p className="project-knowledge-help">启用的资料会自动加入本项目的每次 AI 对话上下文。</p>
        {assetsLoading ? (
          <p className="project-panel-placeholder project-panel-text">正在读取项目资料…</p>
        ) : assets.length === 0 ? (
          <button type="button" className="project-knowledge-empty" onClick={() => fileInputRef.current?.click()}>
            <Plus size={13} /> 上传参考图、面料说明或趋势摘要
          </button>
        ) : (
          <div className="project-knowledge-list">
            {assets.map(asset => (
              <div className={`project-knowledge-item ${asset.enabled ? '' : 'is-disabled'}`} key={asset.id}>
                {asset.image_url ? (
                  <img src={asset.image_url} alt="" />
                ) : (
                  <span className="project-knowledge-file"><FileText size={14} /></span>
                )}
                <div className="project-knowledge-meta">
                  <strong>{asset.name}</strong>
                  <span>{asset.image_url ? '视觉参考' : `${asset.extracted_text.length} 字符`}</span>
                </div>
                <button type="button" onClick={() => void toggleAsset(asset)} title={asset.enabled ? '从 AI 上下文停用' : '加入 AI 上下文'}>
                  {asset.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
                <button type="button" onClick={() => void removeAsset(asset)} title="移除资料">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

export default function ProjectDetailPage({ user }: ProjectDetailPageProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [designs, setDesigns] = useState<DesignThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [starting, setStarting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    fetchProject(user.auth_token, projectId)
      .then(({ project: p, designs: d }) => {
        setProject(p);
        setDesigns(d);
      })
      .catch(() => navigate('/projects'))
      .finally(() => setLoading(false));
  }, [projectId, user.auth_token, navigate]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const handleStart = useCallback(async (promptText?: string) => {
    const text = (promptText ?? input).trim();
    if (!text || starting || !projectId) return;
    setStarting(true);
    try {
      const design = await createDesign(user.auth_token, {
        title: '',
        projectId,
      });
      navigate(`/projects/${projectId}/chat/${design.id}`, { state: { starterPrompt: text } });
    } catch {
      setStarting(false);
    }
  }, [input, starting, projectId, user.auth_token, navigate]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleStart(); }
  };

  const handlePanelSave = useCallback((updated: Partial<Project>) => {
    setProject(prev => prev ? { ...prev, ...updated } : prev);
  }, []);

  if (loading) {
    return (
      <div className="project-detail-loading">
        <span>加载中...</span>
      </div>
    );
  }
  if (!project) return null;

  return (
    <div className="project-detail-page">
      {/* Main content */}
      <div className="project-detail-main">
        <button
          type="button"
          className="project-detail-back"
          onClick={() => navigate('/projects')}
        >
          <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
          全部项目
        </button>

        <h1 className="project-detail-name">{project.name}</h1>
        {project.description && (
          <p className="project-detail-desc">{project.description}</p>
        )}

        {/* Inline input */}
        <div className="project-detail-input-wrap">
          <textarea
            ref={textareaRef}
            className="project-detail-textarea"
            placeholder={`在「${project.name}」里继续设计什么？`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={starting}
          />
          <button
            type="button"
            className="project-detail-send"
            onClick={() => void handleStart()}
            disabled={!input.trim() || starting}
          >
            {starting ? <span className="nd-spinner" /> : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>

        {/* Design history */}
        {designs.length > 0 && (
          <div className="project-detail-history">
            <p className="project-detail-history-label">项目对话记录</p>
            <div className="project-detail-history-list">
              {designs.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className="project-detail-history-item"
                  onClick={() => navigate(`/projects/${projectId}/chat/${d.id}`)}
                >
                  <span className="project-detail-history-title">{d.title || '无标题设计'}</span>
                  <span className="project-detail-history-date">
                    <Clock className="w-3 h-3" strokeWidth={1.5} />
                    {formatDate(d.updated_at)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {designs.length === 0 && (
          <div className="project-detail-empty">
            <p>还没有设计对话，在上方输入开始第一个设计。</p>
          </div>
        )}
      </div>

      {/* Right panel */}
      <RightPanel project={project} authToken={user.auth_token} onSave={handlePanelSave} />
    </div>
  );
}
