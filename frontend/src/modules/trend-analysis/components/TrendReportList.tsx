import { useState, useEffect } from 'react';
import { FileText, RefreshCw, Calendar, TrendingUp, FileSearch } from 'lucide-react';
import type { ReportListItem } from '../types';
import { fetchReportList } from '../trendApi';

interface TrendReportListProps {
  onSelectReport: (report: ReportListItem) => void;
  selectedReportId?: string;
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export default function TrendReportList({ onSelectReport, selectedReportId }: TrendReportListProps) {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadReports() {
    setLoading(true);
    setError(null);
    try {
      const { reports: data } = await fetchReportList(20, 0);
      setReports(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports();
  }, []);

  if (loading) {
    return (
      <div className="trend-report-list trend-report-list--loading">
        <div className="trend-report-list-header">
          <h3 className="trend-report-list-title">趋势报告</h3>
        </div>
        <div className="trend-report-list-body">
          <div className="trend-report-skeleton">
            <RefreshCw size={14} strokeWidth={1.5} className="animate-spin" style={{ color: 'var(--color-ink-3)' }} />
            <span>加载中…</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trend-report-list trend-report-list--error">
        <div className="trend-report-list-header">
          <h3 className="trend-report-list-title">趋势报告</h3>
          <button type="button" onClick={() => void loadReports()} className="trend-report-refresh" title="重新加载">
            <RefreshCw size={12} strokeWidth={1.5} />
          </button>
        </div>
        <div className="trend-report-list-body">
          <div className="trend-report-empty">
            <FileSearch size={18} strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
            <p>加载失败：{error}</p>
            <button type="button" onClick={() => void loadReports()} className="btn-text">
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="trend-report-list trend-report-list--empty">
        <div className="trend-report-list-header">
          <h3 className="trend-report-list-title">趋势报告</h3>
          <button type="button" onClick={() => void loadReports()} className="trend-report-refresh" title="刷新">
            <RefreshCw size={12} strokeWidth={1.5} />
          </button>
        </div>
        <div className="trend-report-list-body">
          <div className="trend-report-empty">
            <FileText size={18} strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
            <p>暂无报告</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="trend-report-list">
      <div className="trend-report-list-header">
        <h3 className="trend-report-list-title">趋势报告</h3>
        <button type="button" onClick={() => void loadReports()} className="trend-report-refresh" title="刷新">
          <RefreshCw size={12} strokeWidth={1.5} />
        </button>
      </div>
      <div className="trend-report-list-body">
        {reports.map((r) => (
          <button
            key={r.report_id}
            type="button"
            onClick={() => onSelectReport(r)}
            className={`trend-report-item ${r.report_id === selectedReportId ? 'active' : ''}`}
          >
            <div className="trend-report-item-header">
              <span className="trend-report-item-title">
                {r.summary ? (r.summary.length > 48 ? r.summary.slice(0, 48) + '…' : r.summary) : r.report_id}
              </span>
              {r.partial && <span className="trend-report-badge">部分</span>}
            </div>
            <div className="trend-report-item-meta">
              {r.report_date && (
                <span className="trend-report-meta-item">
                  <Calendar size={10} strokeWidth={1.5} />
                  {r.report_date}
                </span>
              )}
              {r.generated_at && (
                <span className="trend-report-meta-item">
                  生成于 {fmtDate(r.generated_at)}
                </span>
              )}
            </div>
            {r.covered_sites && r.covered_sites.length > 0 && (
              <div className="trend-report-item-sites">
                {r.covered_sites.slice(0, 2).map((s, i) => (
                  <span key={i} className="trend-report-site-tag">{s}</span>
                ))}
                {r.covered_sites.length > 2 && (
                  <span className="trend-report-site-more">+{r.covered_sites.length - 2}</span>
                )}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
