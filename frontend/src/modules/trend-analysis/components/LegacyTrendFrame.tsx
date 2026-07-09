import { useRef, useState, useEffect } from 'react';
import { WorkspaceSkeleton } from '../../../components/ErrorBoundary';

interface LegacyTrendFrameProps {
  src: string;
}

export default function LegacyTrendFrame({ src }: LegacyTrendFrameProps) {
  const iframeRef  = useRef<HTMLIFrameElement>(null);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const prevBase   = useRef('');
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');

  useEffect(() => {
    // Only show loading overlay for full-page navigations (base URL changed).
    // Hash-only changes trigger hashchange inside the iframe — no reload needed.
    const newBase = src.split('#')[0];
    if (newBase !== prevBase.current) {
      prevBase.current = newBase;
      setStatus('loading');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus('ready'), 15000);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [src]);

  return (
    <div className="ta-frame-wrap">
      <iframe
        ref={iframeRef}
        src={src}
        className="trend-iframe"
        onLoad={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          setStatus('ready');
        }}
        onError={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          setStatus('ready');
        }}
        title="趋势分析"
        sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
      />
      {status === 'loading' && (
        <div className="ta-loading-overlay">
          <WorkspaceSkeleton variant="rows" count={5} label="正在加载趋势分析页面" />
        </div>
      )}
    </div>
  );
}
