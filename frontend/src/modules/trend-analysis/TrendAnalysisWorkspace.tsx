import { useRef, useState, useEffect } from 'react';
import { BarChart3, ExternalLink, Maximize2, Minimize2, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { WorkspaceState } from '../../components/ErrorBoundary';
import type { PipelineState, LatestReport, ServiceStatus, ConnMode, TaskState, ReportListItem } from './types';
import {
  checkTrendHealth,
  fetchPipelineState,
  fetchLatestReport,
  triggerPipeline,
  pausePipeline,
  resumePipeline,
  createPipelineWebSocket,
} from './trendApi';
import PipelineControlPanel from './components/PipelineControlPanel';
import TrendReportList from './components/TrendReportList';
import TrendReportDetail from './components/TrendReportDetail';
import './trend-analysis.css';

function iframeSrcFor(reportId?: string): string {
  const hash = reportId ? `#report/${reportId}` : '';
  return `http://localhost:8002/?embedded=1${hash}`;
}

export default function TrendAnalysisWorkspace() {
  const wsRef      = useRef<WebSocket | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const [svcStatus, setSvcStatus]   = useState<ServiceStatus>('checking');
  const [fullscreen, setFullscreen] = useState(false);
  const [connMode, setConnMode]     = useState<ConnMode>('none');
  const [wsOk, setWsOk]             = useState(false);

  const [pipeline, setPipeline]       = useState<PipelineState>({ is_running: false, pause_requested: false, current_task: {} });
  const [report, setReport]           = useState<LatestReport | null>(null);
  const [reportLoading, setRptLoad]   = useState(false);
  const [action, setAction]           = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [selectedReport, setSelectedReport] = useState<ReportListItem | null>(null);
  const [iframeSrc, setIframeSrc]           = useState<string>(iframeSrcFor());
  const [showLegacy, setShowLegacy]         = useState(false);

  // ── State updaters ────────────────────────────────────────

  async function refreshPipelineState() {
    try {
      const s = await fetchPipelineState();
      if (!mountedRef.current) return;
      setPipeline(s);
      setLastUpdated(new Date());
    } catch { /* polling will retry */ }
  }

  async function refreshLatestReport() {
    if (!mountedRef.current) return;
    setRptLoad(true);
    try {
      const r = await fetchLatestReport();
      if (!mountedRef.current) return;
      setReport(r);
    } catch {
      if (mountedRef.current) setReport(null);
    } finally {
      if (mountedRef.current) setRptLoad(false);
    }
  }

  // ── Polling ───────────────────────────────────────────────

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(() => { void refreshPipelineState(); }, 3000);
    setConnMode('poll');
  }

  // ── WebSocket ─────────────────────────────────────────────

  function connectWs() {
    if (wsRef.current && wsRef.current.readyState < 2) return;

    const ws = createPipelineWebSocket({
      onOpen:  () => { setWsOk(true); setConnMode('ws'); stopPolling(); },
      onError: () => { setWsOk(false); },
      onClose: () => { setConnMode('poll'); startPolling(); },
      onMessage: (type, data) => {
        if (!mountedRef.current) return;
        setLastUpdated(new Date());
        if (type === 'connected' || type === 'progress') {
          const d = data as TaskState & { pause_requested?: boolean };
          setPipeline({ is_running: d.status === 'running', pause_requested: Boolean(d.pause_requested), current_task: d });
        } else if (type === 'started') {
          setPipeline(p => ({ ...p, is_running: true, pause_requested: false }));
        } else if (type === 'completed') {
          setPipeline(p => ({ ...p, is_running: false, current_task: data as TaskState }));
          void refreshLatestReport();
        } else if (type === 'error') {
          setPipeline(p => ({ ...p, is_running: false }));
        } else if (type === 'paused') {
          setPipeline(p => ({ ...p, pause_requested: true }));
        } else if (type === 'resumed') {
          setPipeline(p => ({ ...p, pause_requested: false }));
        }
      },
    });

    wsRef.current = ws;
  }

  // ── Health check & mount ──────────────────────────────────

  async function checkHealth() {
    setSvcStatus('checking');
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const ok = await checkTrendHealth(ctrl.signal);
      clearTimeout(t);
      if (!mountedRef.current) return;
      if (ok) {
        setSvcStatus('up');
        await Promise.all([refreshPipelineState(), refreshLatestReport()]);
        connectWs();
      } else {
        setSvcStatus('down');
      }
    } catch {
      if (mountedRef.current) setSvcStatus('down');
    }
  }

  useEffect(() => {
    mountedRef.current = true; // reset for React StrictMode double-invoke
    void checkHealth();
    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.onopen    = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror   = null;
        wsRef.current.onclose   = null;
        wsRef.current.close();
      }
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Actions ───────────────────────────────────────────────

  async function handleStart() {
    setAction('start');
    try {
      await triggerPipeline();
      if (!mountedRef.current) return;
      setPipeline(p => ({ ...p, is_running: true }));
      await refreshPipelineState();
    } catch { /* user can retry */ }
    if (mountedRef.current) setAction(null);
  }

  async function handlePause() {
    setAction('pause');
    try {
      await pausePipeline();
      if (!mountedRef.current) return;
      setPipeline(p => ({ ...p, pause_requested: true }));
    } catch { /* silent */ }
    if (mountedRef.current) setAction(null);
  }

  async function handleResume() {
    setAction('resume');
    try {
      await resumePipeline();
      if (!mountedRef.current) return;
      setPipeline(p => ({ ...p, pause_requested: false }));
    } catch { /* silent */ }
    if (mountedRef.current) setAction(null);
  }

  async function handleRefresh() {
    setAction('refresh');
    await Promise.all([refreshPipelineState(), refreshLatestReport()]);
    if (mountedRef.current) setAction(null);
  }

  // ── iframe & report selection ─────────────────────────────

  function handleSelectReport(r: ReportListItem) {
    setSelectedReport(r);
    setIframeSrc(iframeSrcFor(r.report_id));
    setShowLegacy(false);
  }

  // ── Derived ───────────────────────────────────────────────

  const busy = action !== null;

  // ── Service down / checking ───────────────────────────────

  if (svcStatus === 'checking') {
    return (
      <div className="ta-state">
        <WorkspaceState kind="loading" eyebrow="趋势分析" title="正在连接分析服务" description="连接成功后会自动打开趋势流水线。" compact />
      </div>
    );
  }

  if (svcStatus === 'down') {
    return (
      <div className="ta-state">
        <WorkspaceState
          kind="error"
          eyebrow="趋势分析"
          title="趋势分析服务暂时不可用"
          description="无法连接趋势分析服务，请确认服务已启动后重试。"
          icon={<BarChart3 size={21} strokeWidth={1.5} />}
          action={{ label: '重新检测', icon: <RefreshCw size={14} strokeWidth={1.5} />, onClick: () => void checkHealth() }}
          secondaryAction={{ label: '在新窗口打开', icon: <ExternalLink size={14} strokeWidth={1.5} />, onClick: () => window.open('http://localhost:8002', '_blank') }}
        />
      </div>
    );
  }

  // ── Main layout ───────────────────────────────────────────

  return (
    <div className={`ta-shell ${fullscreen ? 'fullscreen' : ''}`}>

      {/* Top bar */}
      <div className="ta-bar">
        <div className="ta-bar-left">
          <BarChart3 className="h-3.5 w-3.5" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
          <div>
            <div className="ta-kicker">Pipeline · 趋势分析</div>
            <span className="ta-label">Trend Analysis</span>
          </div>
          {connMode === 'ws' && wsOk
            ? <Wifi size={11} strokeWidth={1.5} style={{ color: 'var(--color-success)' }} aria-label="WebSocket 实时" />
            : connMode === 'poll'
              ? <WifiOff size={11} strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} aria-label="轮询模式" />
              : null
          }
        </div>
        <div className="ta-bar-actions">
          <button type="button" onClick={() => void handleRefresh()} disabled={busy} title="刷新状态" className="ta-icon-btn">
            <RefreshCw className={`h-3.5 w-3.5 ${action === 'refresh' ? 'animate-spin' : ''}`} strokeWidth={1.5} />
          </button>
          <button type="button" onClick={() => setFullscreen(!fullscreen)} title={fullscreen ? '退出全屏' : '全屏'} className="ta-icon-btn">
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
          </button>
          <button type="button" onClick={() => window.open('http://localhost:8002', '_blank')} title="新窗口打开" className="ta-icon-btn">
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Pipeline controls */}
      <PipelineControlPanel
        pipeline={pipeline}
        action={action}
        lastUpdated={lastUpdated}
        latestReport={report}
        reportLoading={reportLoading}
        onStart={() => void handleStart()}
        onPause={() => void handlePause()}
        onResume={() => void handleResume()}
      />

      {/* Body: report list + detail */}
      <div className="ta-body">
        <div className="ta-report-sidebar">
          <TrendReportList
            onSelectReport={handleSelectReport}
            selectedReportId={selectedReport?.report_id}
          />
        </div>
        <TrendReportDetail
          reportId={selectedReport?.report_id}
          showLegacy={showLegacy}
          onToggleLegacy={() => setShowLegacy(v => !v)}
          legacyIframeSrc={iframeSrc}
        />
      </div>
    </div>
  );
}
