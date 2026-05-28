import { useRef, useState, useEffect, useCallback } from 'react';
import { BarChart3, ExternalLink, Maximize2, Minimize2, RefreshCw } from 'lucide-react';

type Status = 'checking' | 'loading' | 'ready' | 'error';

export default function TrendAnalysisWorkspace() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<Status>('checking');
  const [errorMsg, setErrorMsg] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const retryCountRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const checkHealth = useCallback(async () => {
    setStatus('checking');
    setErrorMsg('');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('/api/trend/health', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        setStatus('loading');
        // Set a safety timeout — if iframe doesn't fire onLoad within 15s, show ready anyway
        timeoutRef.current = setTimeout(() => setStatus('ready'), 15000);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError'
        ? '连接超时，请确认趋势分析服务已启动'
        : '无法连接趋势分析服务';
      setErrorMsg(msg);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    checkHealth();
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, [checkHealth]);

  const handleIframeLoad = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setStatus('ready');
    retryCountRef.current = 0;
  };

  const handleIframeError = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setErrorMsg('页面加载失败');
    setStatus('error');
  };

  const refresh = () => {
    retryCountRef.current++;
    if (iframeRef.current && status === 'ready') {
      setStatus('loading');
      iframeRef.current.src = 'http://localhost:8002/?_t=' + Date.now();
      timeoutRef.current = setTimeout(() => setStatus('ready'), 15000);
    } else {
      checkHealth();
    }
  };

  // Error / Checking states
  if (status === 'error' || status === 'checking') {
    return (
      <div className="flex h-full items-center justify-center bg-[color:var(--bg)]">
        <div className="text-center max-w-md px-8 py-16">
          <div className="relative mx-auto mb-8 w-20 h-20">
            <div className="absolute inset-0 rotate-6 rounded-3xl bg-[color:var(--gold-dim)]" />
            <div className="absolute inset-0 -rotate-3 rounded-3xl bg-[color:var(--gold-subtle)]" />
            <div className="relative flex h-full w-full items-center justify-center rounded-3xl border border-[color:var(--border-soft)] bg-white shadow-[var(--shadow-md)]">
              {status === 'checking' ? (
                <RefreshCw className="h-6 w-6 animate-spin text-[color:var(--warm-metal)]" />
              ) : (
                <BarChart3 className="h-7 w-7 text-[color:var(--warm-metal)]" />
              )}
            </div>
          </div>

          <h2 className="mb-3 text-[22px] font-extrabold tracking-[-0.02em] text-[color:var(--text-primary)]">
            {status === 'checking' ? '正在连接...' : '趋势分析服务未就绪'}
          </h2>
          {status === 'error' && (
            <>
              <p className="mb-2 text-[13px] leading-relaxed text-[color:var(--text-muted)]">
                {errorMsg}
              </p>
              <p className="mb-8 text-[13px] leading-relaxed text-[color:var(--text-muted)]">
                请在本机启动趋势服务（端口 8002）。在项目目录执行 <code className="rounded bg-[color:var(--paper)] px-1 text-[12px]">python start.py</code> 或进入{' '}
                <code className="rounded bg-[color:var(--paper)] px-1 text-[12px]">backend\services\trend-analysis</code> 后执行{' '}
                <code className="rounded bg-[color:var(--paper)] px-1 text-[12px]">python run.py</code>。
                若无 ai_fashion，将自动使用内置占位接口；若仍失败请先安装依赖：{' '}
                <code className="rounded bg-[color:var(--paper)] px-1 text-[12px]">pip install -r requirements.txt</code>。
              </p>

              <div className="mx-auto mb-8 max-w-sm rounded-3xl bg-[color:var(--ink)] p-4 text-left shadow-[var(--shadow-md)]">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f57' }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#febc2e' }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
                  </div>
                </div>
                <code className="block text-[12px] leading-relaxed font-mono" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <span className="text-[color:var(--warm-metal)]">$</span> cd 项目目录\fashion design<br/>
                  <span className="text-[color:var(--warm-metal)]">$</span> python start.py<br/>
                  <span className="opacity-60"># 未安装 ai_fashion 时会自动启用 8002 占位服务；完整功能请设置环境变量 AI_FASHION_BACKEND</span>
                </code>
              </div>

              <button
                onClick={refresh}
                className="btn-primary px-6 text-[13px] font-medium"
              >
                <RefreshCw className="h-4 w-4" />
                重新检查
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full flex-col bg-[color:var(--bg)] ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[color:var(--border-soft)] bg-white px-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-[color:var(--text-muted)]" />
          <span className="text-[11px] font-medium text-[color:var(--text-secondary)]">趋势分析</span>
          {status === 'loading' && (
            <span className="text-[10px] text-[color:var(--text-dim)]">加载中...</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {[
            { title: '刷新', onClick: refresh, icon: <RefreshCw className="h-3.5 w-3.5" /> },
            { title: isFullscreen ? '退出全屏' : '全屏', onClick: () => setIsFullscreen(!isFullscreen), icon: isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" /> },
            { title: '新窗口', onClick: () => window.open('http://localhost:8002', '_blank'), icon: <ExternalLink className="h-3.5 w-3.5" /> },
          ].map(btn => (
            <button key={btn.title} onClick={btn.onClick} title={btn.title} className="btn-ghost btn-square h-9 min-h-9 w-9">
              {btn.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Iframe */}
      <div className="flex-1 min-h-0 relative">
        <iframe
          ref={iframeRef}
          src="http://localhost:8002/"
          className="trend-iframe"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          title="趋势分析"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        />
        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--bg)]">
            <div className="text-center">
              <RefreshCw className="mx-auto mb-4 h-6 w-6 animate-spin text-[color:var(--warm-metal)]" />
              <p className="text-[13px] text-[color:var(--text-muted)]">正在加载趋势分析...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
