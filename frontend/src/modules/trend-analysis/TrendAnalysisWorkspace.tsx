import { useRef, useState, useEffect, useCallback } from 'react';

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
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--bg-muted)' }}>
        <div className="text-center max-w-md px-8 py-16">
          {/* Icon */}
          <div className="relative mx-auto mb-8 w-20 h-20">
            <div className="absolute inset-0 rounded-2xl rotate-6" style={{ background: 'var(--gold-dim)' }} />
            <div className="absolute inset-0 rounded-2xl -rotate-3" style={{ background: 'var(--gold-subtle)' }} />
            <div className="relative w-full h-full rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
              {status === 'checking' ? (
                <svg className="animate-spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v18h18M9 17V9m4 8V5m4 12v-4" />
                </svg>
              )}
            </div>
          </div>

          <h2 className="font-display text-[22px] font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
            {status === 'checking' ? '正在连接...' : '趋势分析服务未就绪'}
          </h2>
          {status === 'error' && (
            <>
              <p className="text-[13px] leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>
                {errorMsg}
              </p>
              <p className="text-[13px] leading-relaxed mb-8" style={{ color: 'var(--text-muted)' }}>
                请在本机启动趋势服务（端口 8002）。在项目目录执行 <code className="text-[12px] px-1 rounded" style={{ background: 'var(--bg-muted)' }}>python start.py</code> 或进入{' '}
                <code className="text-[12px] px-1 rounded" style={{ background: 'var(--bg-muted)' }}>backend\services\trend-analysis</code> 后执行{' '}
                <code className="text-[12px] px-1 rounded" style={{ background: 'var(--bg-muted)' }}>python run.py</code>。
                若无 ai_fashion，将自动使用内置占位接口；若仍失败请先安装依赖：{' '}
                <code className="text-[12px] px-1 rounded" style={{ background: 'var(--bg-muted)' }}>pip install -r requirements.txt</code>。
              </p>

              {/* Terminal box */}
              <div className="mx-auto max-w-sm rounded-xl p-4 text-left mb-8"
                style={{ background: 'var(--bg-inverse)', boxShadow: 'var(--shadow-md)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#ff5f57' }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#febc2e' }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#28c840' }} />
                  </div>
                </div>
                <code className="block text-[12px] leading-relaxed font-mono" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <span style={{ color: 'var(--gold)' }}>$</span> cd 项目目录\fashion design<br/>
                  <span style={{ color: 'var(--gold)' }}>$</span> python start.py<br/>
                  <span className="opacity-60"># 未安装 ai_fashion 时会自动启用 8002 占位服务；完整功能请设置环境变量 AI_FASHION_BACKEND</span>
                </code>
              </div>

              <button
                onClick={refresh}
                className="inline-flex items-center gap-2 px-6 py-2.5 text-[13px] font-medium tracking-[0.06em]
                  border-[1.5px] border-[var(--charcoal)] text-[var(--charcoal)] bg-transparent
                  hover:bg-[var(--charcoal)] hover:text-[var(--ivory)] transition-all duration-300"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 4v6h6M23 20v-6h-6" />
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                </svg>
                重新检查
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? 'fixed inset-0 z-50' : ''}`} style={{ background: 'var(--bg-muted)' }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between h-9 px-4 shrink-0"
        style={{ background: 'var(--bg-card)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18M9 17V9m4 8V5m4 12v-4" />
          </svg>
          <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>趋势分析</span>
          {status === 'loading' && (
            <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>加载中...</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {[
            { title: '刷新', onClick: refresh, icon: 'M1 4v6h6M23 20v-6h-6' },
            { title: isFullscreen ? '退出全屏' : '全屏', onClick: () => setIsFullscreen(!isFullscreen), icon: isFullscreen ? 'M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7' : 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' },
            { title: '新窗口', onClick: () => window.open('http://localhost:8002', '_blank'), icon: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3' },
          ].map(btn => (
            <button key={btn.title} onClick={btn.onClick} title={btn.title}
              className="p-1.5 rounded-md transition-colors hover:bg-[var(--bg-muted)]"
              style={{ color: 'var(--text-muted)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d={btn.icon} />
              </svg>
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
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'var(--bg-muted)' }}>
            <div className="text-center">
              <svg className="animate-spin mx-auto mb-4" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>正在加载趋势分析...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
