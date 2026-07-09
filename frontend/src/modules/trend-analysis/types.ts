// Trend Analysis module — shared types
// Matches backend task_runs schema (services/trend/models.py TaskRun)

export interface TaskState {
  run_id?: string;
  status?: string;
  stage_code?: string;
  stage_label?: string;
  stage_detail?: string;
  stage_index?: number;
  stage_total?: number;
  progress_percent?: number;
  error_message?: string;
  started_at?: string;
  finished_at?: string;
  articles_crawled?: number;
  articles_analyzed?: number;
  reports_generated?: number;
  pause_requested?: boolean;
  pipeline_mode?: string;
}

// Matches GET /api/pipeline/state response
export interface PipelineState {
  is_running: boolean;
  pause_requested: boolean;
  current_task: TaskState;
}

// Matches GET /api/reports/latest response (reports table row + JSON)
export interface LatestReport {
  report_id: string;
  summary?: string;
  generated_at?: string;
  report_date?: string;
  covered_sites?: string[];
  time_range?: string;
  partial?: boolean;
}

// Matches GET /api/reports (list) response items
export interface ReportListItem {
  report_id: string;
  summary?: string;
  generated_at?: string;
  report_date?: string;
  covered_sites?: string[];
  time_range?: string;
  season_label_zh?: string;
  season_bucket_id?: string;
  partial?: boolean;
}

// ── Report detail types (models.py FashionTrendReport + nested) ──

export interface EvidenceItem {
  site_name?: string;
  article_title?: string;
  article_url?: string;
  snippet?: string;
  [key: string]: unknown;
}

export interface TrendItem {
  name?: string;
  description?: string;
  category?: string;
  supporting_evidence?: EvidenceItem[];
  related_colors?: string[];
  related_fabrics?: string[];
  related_items?: string[];
  related_patterns?: string[];
  related_silhouettes?: string[];
  confidence?: number;
  selected_images?: string[];
  [key: string]: unknown;
}

export interface StyleDetail {
  name?: string;
  description?: string;
  trend_direction?: string;
  representative_brands?: string[];
  style_tips?: string[];
  selected_images?: string[];
  confidence?: number;
  [key: string]: unknown;
}

export interface SourceArticleDetail {
  unique_key?: string;
  title?: string;
  site_name?: string;
  article_url?: string;
  has_raw_html?: boolean;
  [key: string]: unknown;
}

// Matches GET /api/reports/{report_id} — extends list fields with full JSON content
export interface ReportDetail extends ReportListItem {
  key_trends?: TrendItem[];
  colors?: string[];
  fabrics?: string[];
  silhouettes?: string[];
  items?: string[];
  patterns?: string[];
  style_keywords?: string[];
  consumer_signals?: string[];
  style_details?: StyleDetail[];
  item_details?: StyleDetail[];
  silhouette_details?: StyleDetail[];
  color_details?: StyleDetail[];
  representative_images?: string[];
  source_articles?: string[];
  source_article_details?: SourceArticleDetail[];
  evidence?: EvidenceItem[];
  confidence?: number;
  llm_model?: string;
  token_usage?: Record<string, unknown>;
  llm_provider?: string;
  batch_id?: string;
  season_code?: string;
  season_year?: number;
  body_notice_zh?: string;
  [key: string]: unknown;
}

export type ServiceStatus = 'checking' | 'up' | 'down';
export type ConnMode = 'ws' | 'poll' | 'none';
