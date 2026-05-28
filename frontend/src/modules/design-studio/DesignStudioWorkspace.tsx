import { useState, useRef, useEffect, useCallback } from 'react';
import ChatPanel from './components/ChatPanel';
import FabricEditor from './components/FabricEditor';
import DesignCanvas, { type DesignCanvasHandle } from './components/DesignCanvas';
import ModeBar from './components/ModeBar';
import OnboardingModal from './components/OnboardingModal';
import NewProjectForm from './components/NewProjectForm';
import ProfileDiffModal from './components/ProfileDiffModal';
import SettingsPanel from './components/SettingsPanel';
import { useToast } from '../../components/Toast';
import { Download, PencilRuler, X, MessageSquare, Plus, AlertCircle, RefreshCw, Settings } from 'lucide-react';
import type { DesignerWorkspace, PersonalProfile, SessionMode, DesignerProject, Trend } from '../../types/profile';
import {
  fetchPersonalProfile,
  fetchDesignerWorkspace,
  submitPersonalOnboarding,
  createDesignerProject,
  createConversationSessionWithTrend,
  confirmPersonalReview,
  confirmDesignerReview,
  patchDesignerProject,
} from '../../api/profileApi';

interface HistoryImage {
  url: string;
  type: string;
}

type DesignBackendState = 'checking' | 'ok' | 'error';

interface DesignStudioWorkspaceProps {
  user: { email: string; name: string; auth_token: string };
  initialTrend?: Trend;
}

export default function DesignStudioWorkspace({ user, initialTrend }: DesignStudioWorkspaceProps) {
  const { toast } = useToast();
  const canvasRef = useRef<DesignCanvasHandle>(null);

  const [designBackend, setDesignBackend] = useState<DesignBackendState>('checking');
  const [designBackendDetail, setDesignBackendDetail] = useState('');

  const [editorImageDataUrl, setEditorImageDataUrl] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [pendingAIImage, setPendingAIImage] = useState<string | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem('fashion-studio-chat-collapsed') === '1',
  );
  const [chatSessionId, setChatSessionId] = useState<string | undefined>(undefined);
  const [activeTrendId, setActiveTrendId] = useState<string | undefined>(initialTrend?.id);
  const [trendEnabled, setTrendEnabled] = useState(!!initialTrend);

  // ── Personalization state ──────────────────────────────
  const [selectedMode, setSelectedMode] = useState<SessionMode>('personal');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [personalProfile, setPersonalProfile] = useState<PersonalProfile | null>(null);
  const [workspace, setWorkspace] = useState<DesignerWorkspace | null>(null);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editingProject, setEditingProject] = useState<DesignerProject | null>(null);
  const [pendingReview, setPendingReview] = useState<{
    type: 'personal' | 'designer';
    projectId?: string;
    projectName?: string;
    items: Array<{ tag?: string; pattern?: string; confidence: number; evidence?: string }>;
  } | null>(null);

  // Load profile + workspace on mount
  useEffect(() => {
    void Promise.all([
      fetchPersonalProfile(user.auth_token).then(p => {
        setPersonalProfile(p);
        if (!p?.meta?.onboarding_completed) {
          setShowOnboarding(true);
        } else if (p.pending_review) {
          const r = p.pending_review.result as Record<string, unknown>;
          const items = (r.top_style_keywords as Array<{ tag: string; confidence: number; evidence?: string }> | undefined) || [];
          if (items.length) setPendingReview({ type: 'personal', items });
        }
      }).catch(() => {}),
      fetchDesignerWorkspace(user.auth_token).then(w => {
        setWorkspace(w);
        // Check any project pending review
        for (const proj of w.projects || []) {
          if (proj.pending_review) {
            const r = proj.pending_review.result as Record<string, unknown>;
            const items = (r.design_signatures as Array<{ pattern: string; confidence: number; evidence?: string }> | undefined) || [];
            if (items.length) {
              setPendingReview({ type: 'designer', projectId: proj.id, projectName: proj.name, items });
            }
            break;
          }
        }
      }).catch(() => {}),
    ]);
  }, [user.auth_token]);

  // Init default project selection
  useEffect(() => {
    if (workspace && !selectedProjectId) {
      const active = workspace.projects.find(p => p.status === 'active');
      if (active) setSelectedProjectId(active.id);
    }
  }, [workspace]);

  useEffect(() => {
    localStorage.setItem('fashion-studio-chat-collapsed', chatCollapsed ? '1' : '0');
  }, [chatCollapsed]);

  const recheckDesignBackend = useCallback(async () => {
    setDesignBackend('checking');
    setDesignBackendDetail('');
    try {
      const ac = new AbortController();
      const tid = window.setTimeout(() => ac.abort(), 5000);
      const res = await fetch('/api/design/health', { signal: ac.signal });
      window.clearTimeout(tid);
      if (res.ok) {
        setDesignBackend('ok');
        return;
      }
      setDesignBackend('error');
      if (res.status === 502 || res.status === 503) {
        setDesignBackendDetail(
          `HTTP ${res.status} — 代理连不上 127.0.0.1:8001，设计进程未启动或已退出。请运行 python start.py 或检查 FASHION_DESIGN_BACKEND。`,
        );
      } else {
        setDesignBackendDetail(`HTTP ${res.status}`);
      }
    } catch (e) {
      setDesignBackend('error');
      if (e instanceof Error && e.name === 'AbortError') {
        setDesignBackendDetail('连接超时（5s），设计服务可能未启动');
      } else if (e instanceof Error) {
        setDesignBackendDetail(e.message || '网络错误');
      } else {
        setDesignBackendDetail('无法连接');
      }
    }
  }, []);

  useEffect(() => {
    void recheckDesignBackend();
  }, [recheckDesignBackend]);

  // ── Mode/session management ────────────────────────────

  const handleModeChange = useCallback(async (mode: SessionMode, projectId: string | null) => {
    setSelectedMode(mode);
    setSelectedProjectId(projectId);
    // Create a new personalized session
    try {
      const result = await createConversationSessionWithTrend(
        user.auth_token,
        mode,
        projectId || undefined,
        activeTrendId,
        trendEnabled,
      );
      setChatSessionId(result.session_id);
    } catch { /* fall back to random session — ChatPanel handles this */ }
  }, [user.auth_token, activeTrendId, trendEnabled]);

  const handleOnboardingComplete = useCallback(async (staticData: object) => {
    try {
      const p = await submitPersonalOnboarding(user.auth_token, staticData as Parameters<typeof submitPersonalOnboarding>[1]);
      setPersonalProfile(p);
      toast('个人档案已保存', 'success');
    } catch { toast('保存失败，请重试', 'error'); }
    setShowOnboarding(false);
  }, [user.auth_token, toast]);

  const handleNewProjectComplete = useCallback(async (data: { name: string; brief: object; design_language: object }) => {
    try {
      const result = await createDesignerProject(user.auth_token, data);
      setWorkspace(result.workspace);
      setSelectedProjectId(result.project.id);
      setSelectedMode('designer');
      toast(`项目「${data.name}」已创建`, 'success');
    } catch { toast('创建失败，请重试', 'error'); }
    setShowNewProject(false);
    setEditingProject(null);
  }, [user.auth_token, toast]);

  const handleEditProjectComplete = useCallback(async (data: { name: string; brief: object; design_language: object }) => {
    if (!editingProject) return;
    try {
      const w = await patchDesignerProject(user.auth_token, editingProject.id, data);
      setWorkspace(w);
      toast('项目已更新', 'success');
    } catch { toast('更新失败', 'error'); }
    setEditingProject(null);
  }, [editingProject, user.auth_token, toast]);

  const handleConfirmReview = useCallback(async (accepted: Array<{ tag?: string; pattern?: string; confidence: number }>) => {
    if (!pendingReview) return;
    try {
      if (pendingReview.type === 'personal') {
        const p = await confirmPersonalReview(user.auth_token, accepted);
        setPersonalProfile(p);
        toast('风格档案已更新', 'success');
      } else if (pendingReview.projectId) {
        const w = await confirmDesignerReview(user.auth_token, pendingReview.projectId, accepted);
        setWorkspace(w);
        toast('设计规律已更新', 'success');
      }
    } catch { /* ignore */ }
    setPendingReview(null);
  }, [pendingReview, user.auth_token, toast]);

  // ── Canvas / editor handlers ───────────────────────────

  const handleEditImage = useCallback((imageUrl: string) => {
    if (!imageUrl) return;
    const resolved =
      imageUrl.startsWith('data:') ||
      imageUrl.startsWith('blob:') ||
      imageUrl.startsWith('http://') ||
      imageUrl.startsWith('https://')
        ? imageUrl
        : `${window.location.origin}${imageUrl.startsWith('/') ? '' : '/'}${imageUrl}`;
    setEditorImageDataUrl(resolved);
  }, []);

  const handlePreviewImage = useCallback((imageUrl: string) => {
    setPreviewImage(imageUrl);
  }, []);

  const handleImageGenerated = useCallback((image: HistoryImage) => {
    canvasRef.current?.addImage(image.url);
  }, []);

  const handleAddToCanvas = useCallback((imageUrl: string) => {
    canvasRef.current?.addImage(imageUrl);
  }, []);

  const handleSendToAI = useCallback(
    (imageDataUrl: string) => {
      setPendingAIImage(imageDataUrl);
      toast('图片已准备发送到 AI 对话', 'info');
    },
    [toast],
  );

  const handleDownloadPreview = () => {
    if (!previewImage) return;
    const link = document.createElement('a');
    link.href = previewImage;
    link.download = `design-${Date.now()}.png`;
    link.click();
    toast('开始下载', 'success');
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editorImageDataUrl) setEditorImageDataUrl(null);
        else if (previewImage) setPreviewImage(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setChatCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [editorImageDataUrl, previewImage]);

  return (
    <div className="flex h-full overflow-hidden bg-[color:var(--bg)]">
      <main className="flex-1 flex flex-col relative min-w-0 min-h-0">
        {designBackend === 'error' && (
          <div
            className="shrink-0 flex flex-wrap items-center gap-2 border-b border-amber-200/70 bg-amber-50/90 px-3 py-2 text-[12px] text-[color:var(--text-primary)]"
            role="alert"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-700" aria-hidden />
            <span className="font-medium">设计服务未连接</span>
            <span className="text-amber-900/80">
              对话与上传依赖本机 <code className="px-1 rounded bg-white/70 text-[11px]">127.0.0.1:8001</code>
              {designBackendDetail ? `（${designBackendDetail}）` : ''}。请在项目根执行{' '}
              <code className="px-1 rounded bg-white/70 text-[11px]">python start.py</code>
              ，或配置 <code className="px-1 rounded bg-white/70 text-[11px]">FASHION_DESIGN_BACKEND</code>{' '}
              指向含 <code className="px-1 rounded bg-white/70 text-[11px]">server.py</code> 的目录后单独启动设计进程。
            </span>
            <button
              type="button"
              onClick={() => {
                void recheckDesignBackend();
                toast('已重新检测设计服务', 'info');
              }}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-[color:var(--border)] bg-white px-3 py-1.5 text-[11px] font-semibold text-[color:var(--text-primary)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--paper)] transition-colors"
            >
              <RefreshCw className="w-3 h-3" aria-hidden />
              重试
            </button>
          </div>
        )}
        <DesignCanvas
          ref={canvasRef}
          onEditInEditor={handleEditImage}
          onSendToAI={handleSendToAI}
        />
      </main>

      <ChatPanel
        side="right"
        authToken={user.auth_token}
        mode={selectedMode}
        designerProjectId={selectedProjectId}
        trendId={activeTrendId}
        trendEnabled={trendEnabled}
        onTrendToggle={(id, enabled) => { setActiveTrendId(id); setTrendEnabled(enabled); }}
        modeBar={
          <ModeBar
            authToken={user.auth_token}
            workspace={workspace}
            selectedMode={selectedMode}
            selectedProjectId={selectedProjectId}
            onModeChange={handleModeChange}
            onNewProject={() => setShowNewProject(true)}
            onNeedProject={() => setShowNewProject(true)}
          />
        }
        settingsButton={
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
            title="档案管理"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        }
        onEditImage={handleEditImage}
        onPreviewImage={handlePreviewImage}
        onImageGenerated={handleImageGenerated}
        onAddToCanvas={handleAddToCanvas}
        pendingFromCanvas={pendingAIImage}
        onClearPendingFromCanvas={() => setPendingAIImage(null)}
        onSessionIdChange={setChatSessionId}
        externalSessionId={chatSessionId}
        collapsed={chatCollapsed}
        onToggleCollapse={() => setChatCollapsed((c) => !c)}
      />

      {editorImageDataUrl && (
        <FabricEditor
          imageDataUrl={editorImageDataUrl}
          mode="image"
          sessionId={chatSessionId}
          onClose={() => setEditorImageDataUrl(null)}
          onSendToAI={handleSendToAI}
        />
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-[45] flex items-center justify-center bg-black/70 backdrop-blur-lg"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[85vh] object-contain rounded-lg preview-image-enter"
            />
            <div className="absolute -top-14 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/10 bg-[rgba(16,17,20,0.92)] p-1 backdrop-blur-xl">
              <button
                type="button"
                onClick={() => { handleAddToCanvas(previewImage); setPreviewImage(null); }}
                className="btn-ghost h-10 min-h-10 px-3 text-[11px] text-white/72 hover:bg-white/10 hover:text-white"
              >
                <Plus className="w-3 h-3" /> 置入画布
              </button>
              <button
                type="button"
                onClick={() => { handleEditImage(previewImage); setPreviewImage(null); }}
                className="btn-ghost h-10 min-h-10 px-3 text-[11px] text-white/72 hover:bg-white/10 hover:text-white"
              >
                <PencilRuler className="w-3 h-3" /> 像素编辑
              </button>
              <button
                type="button"
                onClick={() => { handleSendToAI(previewImage); setPreviewImage(null); }}
                className="btn-ghost h-10 min-h-10 px-3 text-[11px] text-white/72 hover:bg-white/10 hover:text-white"
              >
                <MessageSquare className="w-3 h-3" /> AI
              </button>
              <button
                type="button"
                onClick={() => { handleDownloadPreview(); setPreviewImage(null); }}
                className="btn-ghost h-10 min-h-10 px-3 text-[11px] text-white/72 hover:bg-white/10 hover:text-white"
              >
                <Download className="w-3 h-3" /> 下载
              </button>
              <div className="h-4 w-px bg-white/10" />
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="btn-ghost btn-square h-10 min-h-10 w-10 text-white/60 hover:bg-white/10 hover:text-white"
                title="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showOnboarding && (
        <OnboardingModal
          onComplete={handleOnboardingComplete}
          onSkip={() => setShowOnboarding(false)}
        />
      )}

      {(showNewProject || editingProject) && !showOnboarding && (
        editingProject ? (
          <NewProjectForm
            onComplete={handleEditProjectComplete}
            onCancel={() => setEditingProject(null)}
          />
        ) : (
          <NewProjectForm
            onComplete={handleNewProjectComplete}
            onCancel={() => setShowNewProject(false)}
          />
        )
      )}

      {pendingReview && (
        <ProfileDiffModal
          type={pendingReview.type}
          projectName={pendingReview.projectName}
          newItems={pendingReview.items}
          onConfirm={handleConfirmReview}
          onDismiss={() => setPendingReview(null)}
        />
      )}

      {showSettings && (
        <SettingsPanel
          authToken={user.auth_token}
          onClose={() => setShowSettings(false)}
          onEditProject={(proj) => { setShowSettings(false); setEditingProject(proj); }}
        />
      )}
    </div>
  );
}
