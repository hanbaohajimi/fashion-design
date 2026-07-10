import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { useToast } from '../../components/Toast';
import { Download, PencilRuler, X, MessageSquare, Plus, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import type { PersonalProfile, Trend } from '../../types/profile';
import type { DesignCanvasHandle } from './components/DesignCanvas';
import type { CapabilityId } from './utils/capabilities';
import { fetchDesign } from '../../api/designsApi';
import type {
  CanvasBottomPanel,
  ChatImage,
  ChatMessage,
  TrendHotBlock,
  TrendHotItem,
  TrendHotStatus,
} from './components/chat-panel/types';
import {
  TREND_DIM_LABELS,
  TREND_DIM_ORDER,
  fetchTrendHotItems,
  getOriginalImageUrl,
  parseTimestamp,
} from './components/chat-panel/utils';
import { TrendHotInline } from './components/chat-panel/TrendHotInline';
import {
  fetchPersonalProfile,
  fetchDesignerWorkspace,
  submitPersonalOnboarding,
  confirmPersonalReview,
  confirmDesignerReview,
} from '../../api/profileApi';

const ChatPanel = lazy(() => import('./components/ChatPanel'));
const FabricEditor = lazy(() => import('./components/FabricEditor'));
const DesignCanvas = lazy(() => import('./components/DesignCanvas'));
const OnboardingModal = lazy(() => import('./components/OnboardingModal'));
const ProfileDiffModal = lazy(() => import('./components/ProfileDiffModal'));

type DesignBackendState = 'checking' | 'ok' | 'error';

interface DesignStudioWorkspaceProps {
  user: { email: string; name: string; auth_token: string };
  initialTrend?: Trend;
  /** Route param: project this chat belongs to (optional). */
  projectId?: string;
  /** Route param: existing design/chat ID to resume. */
  designId?: string;
  /** Prompt pre-filled from navigation state (NewDesignPage / ProjectDetailPage). */
  starterPrompt?: string;
}

function SectionLoader({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center bg-[color:var(--bg)]">
      <div className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--surface)] px-5 py-4 shadow-[var(--shadow-md)]">
        <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{label}</p>
        <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{detail}</p>
      </div>
    </div>
  );
}

function ModalLoader({ label }: { label: string }) {
  return <SectionLoader label={label} detail="正在按需加载内容..." />;
}

export default function DesignStudioWorkspace({ user, initialTrend, projectId, designId, starterPrompt: starterPromptProp }: DesignStudioWorkspaceProps) {
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
  const [focusComposerRequest, setFocusComposerRequest] = useState(0);
  const [chatSessionId, setChatSessionId] = useState<string | undefined>(designId);
  const [initialChatMessages, setInitialChatMessages] = useState<ChatMessage[] | undefined>(undefined);
  const [activeTrendId, setActiveTrendId] = useState<string | undefined>(initialTrend?.id);
  const [trendEnabled, setTrendEnabled] = useState(!!initialTrend);
  const [activeBottomPanel, setActiveBottomPanel] = useState<CanvasBottomPanel>(
    initialTrend ? 'trend-pulse' : null,
  );
  const [currentModeLabel, setCurrentModeLabel] = useState('生成成衣效果图');
  const [canvasBottomPanelHost, setCanvasBottomPanelHost] = useState<HTMLDivElement | null>(null);
  const [trendHotItems, setTrendHotItems] = useState<TrendHotItem[]>([]);
  const [trendHotCategory, setTrendHotCategory] = useState('');
  const [trendHotStatus, setTrendHotStatus] = useState<TrendHotStatus>('loading');
  const trendRequestRef = useRef<AbortController | null>(null);
  // 画布当前选中图片 URL（用于 ChatPanel 素材联动）
  const [selectedCanvasImageUrl, setSelectedCanvasImageUrl] = useState<string | null>(null);

  // ── Personalization state ──────────────────────────────
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projectId ?? null);
  const [personalProfile, setPersonalProfile] = useState<PersonalProfile | null>(null);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [showQuickStart, setShowQuickStart] = useState(false);
  // starterPromptProp comes from router navigate() state (NewDesignPage / ProjectDetailPage)
  const [starterPrompt, setStarterPrompt] = useState<string | undefined>(starterPromptProp);
  const [pendingReview, setPendingReview] = useState<{
    type: 'personal' | 'designer';
    projectId?: string;
    projectName?: string;
    items: Array<{ tag?: string; pattern?: string; confidence: number; evidence?: string }>;
  } | null>(null);
  const quickStartDismissKey = `fashion-quick-start-dismissed:${user.email}`;

  // Load profile + workspace on mount
  useEffect(() => {
    void Promise.all([
      fetchPersonalProfile(user.auth_token).then(p => {
        setPersonalProfile(p);
        if (!p?.meta?.onboarding_completed) {
          setNeedsOnboarding(true);
          setShowQuickStart(sessionStorage.getItem(quickStartDismissKey) !== '1');
        } else if (p.pending_review) {
          const r = p.pending_review.result as Record<string, unknown>;
          const items = (r.top_style_keywords as Array<{ tag: string; confidence: number; evidence?: string }> | undefined) || [];
          if (items.length) setPendingReview({ type: 'personal', items });
        }
      }).catch(() => {}),
      fetchDesignerWorkspace(user.auth_token).then(w => {
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
  }, [user.auth_token, quickStartDismissKey]);

  useEffect(() => {
    localStorage.setItem('fashion-studio-chat-collapsed', chatCollapsed ? '1' : '0');
  }, [chatCollapsed]);

  useEffect(() => {
    setActiveTrendId(initialTrend?.id);
    setTrendEnabled(!!initialTrend);
    setActiveBottomPanel(initialTrend ? 'trend-pulse' : null);
    setTrendHotCategory('');
  }, [designId, projectId, initialTrend?.id]);

  const loadTrendHotTags = useCallback(async () => {
    trendRequestRef.current?.abort();
    const controller = new AbortController();
    trendRequestRef.current = controller;
    setTrendHotStatus('loading');
    try {
      const items = await fetchTrendHotItems(trendHotCategory, controller.signal);
      if (controller.signal.aborted) return;
      setTrendHotItems(items);
      setTrendHotStatus(items.length ? 'ok' : 'empty');
    } catch {
      if (controller.signal.aborted) return;
      setTrendHotItems([]);
      setTrendHotStatus('error');
    } finally {
      if (trendRequestRef.current === controller) trendRequestRef.current = null;
    }
  }, [trendHotCategory]);

  useEffect(() => {
    if (!trendEnabled) {
      trendRequestRef.current?.abort();
      trendRequestRef.current = null;
      return;
    }
    void loadTrendHotTags();
    return () => trendRequestRef.current?.abort();
  }, [trendEnabled, loadTrendHotTags]);

  const trendHotDisplayBlocks = useMemo<TrendHotBlock[]>(() => {
    if (!trendHotItems.length) return [];
    const perGroup = trendHotCategory ? 28 : 10;
    if (trendHotCategory) {
      return [{
        key: trendHotCategory,
        label: TREND_DIM_LABELS[trendHotCategory] || trendHotCategory,
        items: trendHotItems.slice(0, perGroup),
      }];
    }
    const byCategory = new Map<string, TrendHotItem[]>();
    for (const item of trendHotItems) {
      const category = item.category || 'other';
      const group = byCategory.get(category) || [];
      group.push(item);
      byCategory.set(category, group);
    }
    const blocks: TrendHotBlock[] = [];
    for (const category of TREND_DIM_ORDER) {
      const items = byCategory.get(category);
      if (!items?.length) continue;
      blocks.push({
        key: category,
        label: TREND_DIM_LABELS[category] || category,
        items: items.slice(0, perGroup),
      });
      byCategory.delete(category);
    }
    for (const [category, items] of byCategory) {
      blocks.push({
        key: category,
        label: items[0]?.categoryLabel || category,
        items: items.slice(0, perGroup),
      });
    }
    return blocks;
  }, [trendHotItems, trendHotCategory]);

  const toggleBottomPanel = useCallback((panel: Exclude<CanvasBottomPanel, null>) => {
    setActiveBottomPanel(current => current === panel ? null : panel);
  }, []);

  const toggleTrendPanel = useCallback((trendId?: string) => {
    if (trendId) setActiveTrendId(trendId);
    const closingTrendPanel = activeBottomPanel === 'trend-pulse';
    setActiveBottomPanel(closingTrendPanel ? null : 'trend-pulse');
    setTrendEnabled(!closingTrendPanel);
  }, [activeBottomPanel]);

  const bindCanvasBottomPanelHost = useCallback((node: HTMLDivElement | null) => {
    setCanvasBottomPanelHost(node);
  }, []);

  const handleActiveCapabilityChange = useCallback((_capabilityId: CapabilityId, displayTitle: string) => {
    setCurrentModeLabel(displayTitle);
  }, []);

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

  useEffect(() => {
    if (!designId) {
      setInitialChatMessages(undefined);
      return;
    }
    setChatSessionId(designId);
    fetchDesign(user.auth_token, designId)
      .then(({ design, messages }) => {
        setSelectedProjectId(design.project_id);
        setInitialChatMessages(messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          images: m.images,
          timestamp: parseTimestamp(m.created_at),
        })));
      })
      .catch(() => setInitialChatMessages(undefined));
  }, [designId, user.auth_token]);

  const handleOnboardingComplete = useCallback(async (staticData: object) => {
    try {
      const p = await submitPersonalOnboarding(user.auth_token, staticData as Parameters<typeof submitPersonalOnboarding>[1]);
      setPersonalProfile(p);
      setNeedsOnboarding(false);
      setShowQuickStart(false);
      sessionStorage.removeItem(quickStartDismissKey);
      toast('个人档案已保存', 'success');
    } catch { toast('保存失败，请重试', 'error'); }
    setShowOnboarding(false);
  }, [user.auth_token, toast, quickStartDismissKey]);

  const dismissQuickStart = useCallback(() => {
    sessionStorage.setItem(quickStartDismissKey, '1');
    setShowQuickStart(false);
  }, [quickStartDismissKey]);

  const handleQuickStart = useCallback((prompt: string) => {
    setStarterPrompt(prompt);
    setChatCollapsed(false);
    dismissQuickStart();
  }, [dismissQuickStart]);

  const handleDescribeDesign = useCallback(() => {
    setChatCollapsed(false);
    setFocusComposerRequest(request => request + 1);
  }, []);

  const handleConfirmReview = useCallback(async (accepted: Array<{ tag?: string; pattern?: string; confidence: number }>) => {
    if (!pendingReview) return;
    try {
      if (pendingReview.type === 'personal') {
        const p = await confirmPersonalReview(user.auth_token, accepted);
        setPersonalProfile(p);
        toast('风格档案已更新', 'success');
      } else if (pendingReview.projectId) {
        await confirmDesignerReview(user.auth_token, pendingReview.projectId, accepted);
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

  const handleImageGenerated = useCallback((image: ChatImage) => {
    canvasRef.current?.addImage(getOriginalImageUrl(image));
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
    <div className="studio-layout">
      <main className="studio-canvas-area">
        {designBackend === 'error' && (
          <div
            className="editorial-alert"
            role="alert"
          >
            <AlertCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--color-warning)' }} strokeWidth={1.5} aria-hidden />
            <span className="kicker" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--color-warning)' }}>设计服务未连接</span>
            <span style={{ color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
              对话与上传依赖本机 <code className="editorial-code">127.0.0.1:8001</code>
              {designBackendDetail ? `（${designBackendDetail}）` : ''}。请在项目根执行{' '}
              <code className="editorial-code">python start.py</code>
              ，或配置 <code className="editorial-code">FASHION_DESIGN_BACKEND</code>{' '}
              指向含 <code className="editorial-code">server.py</code> 的目录后单独启动设计进程。
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
        <div className="canvas-workspace-scroll">
          <div className="canvas-workspace-main">
            <Suspense fallback={<SectionLoader label="设计画布" detail="正在加载编辑器..." />}>
              <DesignCanvas
                ref={canvasRef}
                currentModeLabel={currentModeLabel}
                onDescribeDesign={handleDescribeDesign}
                onEditInEditor={handleEditImage}
                onSendToAI={handleSendToAI}
                onSelectionChange={setSelectedCanvasImageUrl}
              />
            </Suspense>
          </div>
          <section
            className="canvas-bottom-panel-host"
            data-open={activeBottomPanel !== null}
            aria-label="画布辅助面板"
          >
            <div className="canvas-bottom-panel-content">
              {activeBottomPanel === 'trend-pulse' && (
                <TrendHotInline
                  trendHotCategory={trendHotCategory}
                  trendHotStatus={trendHotStatus}
                  trendHotDisplayBlocks={trendHotDisplayBlocks}
                  onCategoryChange={setTrendHotCategory}
                  onReloadHot={() => void loadTrendHotTags()}
                  onApplyHotTag={(word) => {
                    setStarterPrompt(
                      `结合「${word}」流行趋势热点，设计一件女装方向的概念成衣效果图，造型完整清晰、中性棚拍柔光、突出该趋势风格特征`,
                    );
                    setChatCollapsed(false);
                  }}
                />
              )}
              <div ref={bindCanvasBottomPanelHost} className="canvas-bottom-panel-portal" />
            </div>
          </section>
        </div>
      </main>

      {/* 画布与对话区的视觉分界 */}
      {!chatCollapsed && (
        <div
          className="studio-workspace-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="画布与 AI 对话区分界"
        />
      )}

      <Suspense fallback={<SectionLoader label="对话侧栏" detail="正在加载会话面板..." />}>
        <ChatPanel
          side="right"
          authToken={user.auth_token}
          projectId={selectedProjectId}
          trendId={activeTrendId}
          trendEnabled={trendEnabled}
          activeBottomPanel={activeBottomPanel}
          canvasBottomPanelHost={canvasBottomPanelHost}
          onBottomPanelToggle={toggleBottomPanel}
          onActiveCapabilityChange={handleActiveCapabilityChange}
          designId={designId}
          initialMessages={initialChatMessages}
          selectedCanvasImageUrl={selectedCanvasImageUrl}
          onTrendToggle={toggleTrendPanel}
          firstRunPanel={needsOnboarding && showQuickStart ? (
            <aside className="quick-start-dock quick-start-dock--inline" aria-label="快速开始">
              <button
                type="button"
                className="quick-start-dock__close"
                onClick={dismissQuickStart}
                title="关闭"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
              <div className="quick-start-dock__heading">
                <span className="quick-start-dock__mark"><Sparkles size={15} strokeWidth={1.5} /></span>
                <div>
                  <p className="quick-start-dock__eyebrow">第一次创作</p>
                  <h2>先做一版，再完善偏好</h2>
                </div>
              </div>
              <p className="quick-start-dock__description">
                选择一个方向，需求会直接放入对话框，你可以修改后发送。
              </p>
              <div className="quick-start-dock__prompts">
                <button type="button" onClick={() => handleQuickStart('设计一件适合通勤的极简连衣裙，廓形利落，使用低饱和中性色，并生成完整成衣效果图。')}>
                  极简通勤
                </button>
                <button type="button" onClick={() => handleQuickStart('设计一套具有轻复古气质的春秋女装，强调层次、面料质感和日常可穿性。')}>
                  轻复古日常
                </button>
                <button type="button" onClick={() => handleQuickStart('从当季趋势中提取一个明确方向，设计一件具有视觉记忆点但可实际穿着的概念成衣。')}>
                  当季趋势
                </button>
              </div>
              <button
                type="button"
                className="quick-start-dock__profile"
                onClick={() => {
                  dismissQuickStart();
                  setShowOnboarding(true);
                }}
              >
                先完善我的偏好
              </button>
            </aside>
          ) : null}
          starterPrompt={starterPrompt}
          onStarterPromptConsumed={() => setStarterPrompt(undefined)}
          focusComposerRequest={focusComposerRequest}
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
      </Suspense>

      {editorImageDataUrl && (
        <Suspense fallback={<ModalLoader label="像素编辑器" />}>
          <FabricEditor
            imageDataUrl={editorImageDataUrl}
            mode="image"
            sessionId={chatSessionId}
            authToken={user.auth_token}
            onClose={() => setEditorImageDataUrl(null)}
            onSendToAI={handleSendToAI}
          />
        </Suspense>
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
            <div className="absolute -top-14 left-1/2 flex -translate-x-1/2 items-center gap-0.5 border p-1 backdrop-blur-xl" style={{ background: 'rgba(26, 24, 21, 0.94)', borderColor: 'rgba(245, 242, 236, 0.14)' }}>
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
        <Suspense fallback={<ModalLoader label="新手问卷" />}>
          <OnboardingModal
            onComplete={handleOnboardingComplete}
            onSkip={() => setShowOnboarding(false)}
          />
        </Suspense>
      )}

      {pendingReview && (
        <Suspense fallback={<ModalLoader label="档案确认" />}>
          <ProfileDiffModal
            type={pendingReview.type}
            projectName={pendingReview.projectName}
            newItems={pendingReview.items}
            onConfirm={handleConfirmReview}
            onDismiss={() => setPendingReview(null)}
          />
        </Suspense>
      )}

    </div>
  );
}
