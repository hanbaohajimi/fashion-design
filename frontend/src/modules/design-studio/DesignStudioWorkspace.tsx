import { useState, useRef, useEffect, useCallback } from 'react';
import ChatPanel from './components/ChatPanel';
import FabricEditor from './components/FabricEditor';
import DesignCanvas, { type DesignCanvasHandle } from './components/DesignCanvas';
import { useToast } from '../../components/Toast';
import { Download, PencilRuler, X, MessageSquare, Plus, AlertCircle, RefreshCw } from 'lucide-react';

interface HistoryImage {
  url: string;
  type: string;
}

type DesignBackendState = 'checking' | 'ok' | 'error';

export default function DesignStudioWorkspace() {
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
    <div className="flex h-full overflow-hidden bg-[var(--bg)]">
      <main className="flex-1 flex flex-col relative min-w-0 min-h-0">
        {designBackend === 'error' && (
          <div
            className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 text-[12px] border-b border-amber-200/90 bg-amber-50/95 text-amber-950"
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
              className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-white/90 border border-amber-200 text-amber-900 hover:bg-amber-100/80 transition-colors"
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
        onEditImage={handleEditImage}
        onPreviewImage={handlePreviewImage}
        onImageGenerated={handleImageGenerated}
        onAddToCanvas={handleAddToCanvas}
        pendingFromCanvas={pendingAIImage}
        onClearPendingFromCanvas={() => setPendingAIImage(null)}
        onSessionIdChange={setChatSessionId}
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
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-0.5 p-0.5 bg-[#18181b]/90 backdrop-blur-xl rounded-lg ring-1 ring-white/[0.05]">
              <button
                type="button"
                onClick={() => {
                  handleAddToCanvas(previewImage);
                  setPreviewImage(null);
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-gray-400 hover:text-white hover:bg-white/8 rounded-md transition-colors"
              >
                <Plus className="w-3 h-3" /> 置入画布
              </button>
              <button
                type="button"
                onClick={() => {
                  handleEditImage(previewImage);
                  setPreviewImage(null);
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-gray-400 hover:text-white hover:bg-white/8 rounded-md transition-colors"
              >
                <PencilRuler className="w-3 h-3" /> 像素编辑
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSendToAI(previewImage);
                  setPreviewImage(null);
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-gray-400 hover:text-white hover:bg-white/8 rounded-md transition-colors"
              >
                <MessageSquare className="w-3 h-3" /> AI
              </button>
              <button
                type="button"
                onClick={() => {
                  handleDownloadPreview();
                  setPreviewImage(null);
                }}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-gray-400 hover:text-white hover:bg-white/8 rounded-md transition-colors"
              >
                <Download className="w-3 h-3" /> 下载
              </button>
              <div className="w-px h-4 bg-white/[0.06]" />
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-1.5 text-gray-500 hover:text-white hover:bg-white/8 rounded-md transition-colors"
                title="关闭"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
