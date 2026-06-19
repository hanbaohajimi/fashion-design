import { useRef, useState, useEffect, useCallback } from 'react';
import { BarChart3, ExternalLink, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import './trend-analysis.css';

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

  if (status === 'error' || status === 'checking') {
    return (
      <div className="ta-state">
        <div className="ta-state-inner">
          <p className="ta-state-kicker">Trend Analysis · Embedded</p>
          <h2 className="ta-state-title">
            {status === 'checking' ? 'Connecting…' : 'Service unavailable'}
          </h2>
          {status === 'checking' ? (
            <RefreshCw className="mx-auto h-6 w-6 animate-spin" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
          ) : (
            <>
              <p className="ta-state-quote">
                &ldquo;The pipeline waits at the door until port 8002 answers.&rdquo;
              </p>
              <p className="ta-state-hint">{errorMsg}</p>
              <p className="ta-state-hint">
                请在本机启动趋势服务（端口 8002）。在项目目录执行{' '}
                <code>python start.py</code>，或进入 <code>services/trend</code> 后执行{' '}
                <code>python -m trend_runner</code>。
              </p>
              <div className="ta-terminal">
                <code>
                  <span className="prompt">$</span> cd fashion-design<br />
                  <span className="prompt">$</span> python start.py
                </code>
              </div>
              <button type="button" onClick={refresh} className="ta-retry">
                <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
                重新检查
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`ta-shell ${isFullscreen ? 'fullscreen' : ''}`}>
      <div className="ta-bar">
        <div className="ta-bar-left">
          <BarChart3 className="h-3.5 w-3.5" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
          <div>
            <div className="ta-kicker">Pipeline · 趋势分析</div>
            <span className="ta-label">Trend Analysis</span>
          </div>
          <span className="ta-embedded">Embedded view</span>
          {status === 'loading' && <span className="ta-status">Loading…</span>}
        </div>
        <div className="ta-bar-actions">
          <button type="button" onClick={refresh} title="刷新" className="ta-icon-btn">
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? '退出全屏' : '全屏'}
            className="ta-icon-btn"
          >
            {isFullscreen
              ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            onClick={() => window.open('http://localhost:8002', '_blank')}
            title="新窗口"
            className="ta-icon-btn"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div className="ta-frame-wrap">
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
          <div className="ta-loading-overlay">
            <div style={{ textAlign: 'center' }}>
              <RefreshCw className="mx-auto h-6 w-6 animate-spin" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
              <p>Loading pipeline…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
