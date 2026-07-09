import { RefreshCw, Play, Pause, RotateCcw } from 'lucide-react';
import type { PipelineState, LatestReport } from '../types';
import LatestReportCard from './LatestReportCard';

interface PipelineControlPanelProps {
  pipeline: PipelineState;
  action: string | null;
  lastUpdated: Date | null;
  latestReport: LatestReport | null;
  reportLoading: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function badgeClass(status?: string): string {
  const map: Record<string, string> = {
    running: 'ta-badge ta-badge--running',
    success: 'ta-badge ta-badge--success',
    failed:  'ta-badge ta-badge--error',
    partial: 'ta-badge ta-badge--warn',
  };
  return map[status ?? ''] ?? 'ta-badge ta-badge--idle';
}

function statusLabel(isRunning: boolean, pauseReq: boolean, taskStatus?: string): string {
  if (isRunning && pauseReq) return '暂停中…';
  if (isRunning) return '运行中';
  const map: Record<string, string> = {
    success: '成功', failed: '失败', partial: '部分完成', pending: '等待中',
  };
  return map[taskStatus ?? ''] ?? '空闲';
}

export default function PipelineControlPanel({
  pipeline,
  action,
  lastUpdated,
  latestReport,
  reportLoading,
  onStart,
  onPause,
  onResume,
}: PipelineControlPanelProps) {
  const { is_running, pause_requested, current_task } = pipeline;
  const busy      = action !== null;
  const canStart  = !is_running && !busy;
  const canPause  = is_running && !pause_requested && !busy;
  const canResume = is_running && pause_requested && !busy;

  return (
    <div className="ta-panel">

      {/* Left: status + progress + stage */}
      <div className="ta-panel-left">
        <div className="ta-panel-status-row">
          <span className={badgeClass(current_task.status)}>
            {is_running && <span className="ta-badge-dot" />}
            {statusLabel(is_running, pause_requested, current_task.status)}
          </span>
          {lastUpdated && (
            <span className="ta-panel-ts">
              {lastUpdated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}
        </div>

        {is_running && (
          <div className="ta-panel-progress">
            <div className="ta-progress-bar">
              <div className="ta-progress-fill" style={{ width: `${current_task.progress_percent ?? 0}%` }} />
            </div>
            <span className="ta-progress-pct">{current_task.progress_percent ?? 0}%</span>
          </div>
        )}

        {(current_task.stage_label || current_task.stage_detail) && (
          <div className="ta-panel-stage">
            {current_task.stage_label && <span className="ta-stage-label">{current_task.stage_label}</span>}
            {current_task.stage_detail && <span className="ta-stage-detail">{current_task.stage_detail}</span>}
          </div>
        )}

        {!is_running && current_task.error_message && (
          <p className="ta-panel-error">{current_task.error_message}</p>
        )}

        {current_task.run_id && (
          <div className="ta-panel-stats">
            {current_task.started_at && <span>开始 {fmtTime(current_task.started_at)}</span>}
            {(current_task.articles_crawled ?? 0) > 0 && <span>抓取 {current_task.articles_crawled}</span>}
            {(current_task.articles_analyzed ?? 0) > 0 && <span>分析 {current_task.articles_analyzed}</span>}
            {(current_task.reports_generated ?? 0) > 0 && <span>报告 {current_task.reports_generated}</span>}
          </div>
        )}
      </div>

      {/* Right: controls + latest report */}
      <div className="ta-panel-right">
        <div className="ta-panel-controls">
          <button type="button" onClick={onStart} disabled={!canStart} className="ta-btn ta-btn--primary">
            {action === 'start'
              ? <RefreshCw size={11} strokeWidth={1.5} className="animate-spin" />
              : <Play size={11} strokeWidth={1.5} />}
            启动
          </button>

          {(is_running && !pause_requested) && (
            <button type="button" onClick={onPause} disabled={!canPause} className="ta-btn ta-btn--ghost">
              {action === 'pause'
                ? <RefreshCw size={11} strokeWidth={1.5} className="animate-spin" />
                : <Pause size={11} strokeWidth={1.5} />}
              暂停
            </button>
          )}

          {(is_running && pause_requested) && (
            <button type="button" onClick={onResume} disabled={!canResume} className="ta-btn ta-btn--ghost">
              {action === 'resume'
                ? <RefreshCw size={11} strokeWidth={1.5} className="animate-spin" />
                : <RotateCcw size={11} strokeWidth={1.5} />}
              继续
            </button>
          )}
        </div>

        <LatestReportCard report={latestReport} loading={reportLoading} />
      </div>
    </div>
  );
}
