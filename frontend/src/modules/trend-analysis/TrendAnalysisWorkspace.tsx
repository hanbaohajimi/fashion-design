import { useRef, useState, useEffect, useCallback } from 'react';
import { BarChart3, ExternalLink, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { WorkspaceSkeleton, WorkspaceState } from '../../components/ErrorBoundary';
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

  if (status === 'checking') {
    return (
      <div className="ta-state">
        <WorkspaceState
          kind="loading"
          eyebrow="趋势分析"
          title="正在连接分析服务"
          description="连接成功后会自动打开趋势流水线。"
          compact
        />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="ta-state">
        <WorkspaceState
          kind="error"
          eyebrow="趋势分析"
          title="趋势分析服务暂时不可用"
          description={errorMsg || '无法连接趋势分析服务，请稍后重试。'}
          icon={<BarChart3 size={21} strokeWidth={1.5} />}
          action={{
            label: '重新检测',
            icon: <RefreshCw size={14} strokeWidth={1.5} />,
            onClick: refresh,
          }}
          secondaryAction={{
            label: '在新窗口打开',
            icon: <ExternalLink size={14} strokeWidth={1.5} />,
            onClick: () => window.open('http://localhost:8002', '_blank'),
          }}
        />
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
            <WorkspaceSkeleton variant="rows" count={5} label="正在加载趋势分析页面" />
          </div>
        )}
      </div>
    </div>
  );
}
