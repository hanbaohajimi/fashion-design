import { RefreshCw } from 'lucide-react';
import type { LatestReport } from '../types';

interface LatestReportCardProps {
  report: LatestReport | null;
  loading: boolean;
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

export default function LatestReportCard({ report, loading }: LatestReportCardProps) {
  if (loading) {
    return (
      <div className="ta-panel-report ta-panel-report--loading">
        <RefreshCw size={11} strokeWidth={1.5} className="animate-spin" style={{ color: 'var(--color-ink-3)' }} />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="ta-panel-report ta-panel-report--empty">
        <p className="ta-report-eyebrow">最近报告</p>
        <p className="ta-report-summary" style={{ color: 'var(--color-ink-3)' }}>暂无报告，启动流水线后生成</p>
      </div>
    );
  }

  return (
    <div className="ta-panel-report">
      <p className="ta-report-eyebrow">最近报告</p>
      <p className="ta-report-summary">
        {(report.summary ?? '').length > 72
          ? report.summary!.slice(0, 72) + '…'
          : (report.summary || '(无摘要)')}
      </p>
      <p className="ta-report-ts">{fmtTime(report.generated_at)}</p>
    </div>
  );
}
