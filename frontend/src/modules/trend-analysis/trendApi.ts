// Trend Analysis module — API layer
// All requests via Vite proxy: /api/trend/* → localhost:8002/api/*
// WebSocket: /ws/pipeline → localhost:8002/ws/pipeline

import type { PipelineState, LatestReport, ReportListItem, ReportDetail } from './types';

const BASE = '/api/trend';

async function trendFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function checkTrendHealth(signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(`${BASE}/health`, { signal });
  return res.ok;
}

export async function fetchPipelineState(): Promise<PipelineState> {
  return trendFetch<PipelineState>('/pipeline/state');
}

export async function triggerPipeline(mode = 'full'): Promise<{ status: string; mode: string }> {
  return trendFetch('/pipeline/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

export async function pausePipeline(): Promise<{ status: string; run_id: string }> {
  return trendFetch('/pipeline/pause', { method: 'POST' });
}

export async function resumePipeline(): Promise<{ status: string; run_id: string }> {
  return trendFetch('/pipeline/resume', { method: 'POST' });
}

export async function fetchLatestReport(): Promise<LatestReport> {
  return trendFetch<LatestReport>('/reports/latest');
}

export async function fetchReportList(
  limit = 20,
  offset = 0,
): Promise<{ reports: ReportListItem[]; total: number }> {
  return trendFetch<{ reports: ReportListItem[]; total: number }>(
    `/reports?limit=${limit}&offset=${offset}`,
  );
}

export async function fetchReportDetail(reportId: string, signal?: AbortSignal): Promise<ReportDetail> {
  const res = await fetch(`${BASE}/reports/${encodeURIComponent(reportId)}`, { signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<ReportDetail>;
}

// ── WebSocket ─────────────────────────────────────────────

export interface WsHandlers {
  onMessage: (type: string, data: Record<string, unknown>) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
}

export function createPipelineWebSocket(handlers: WsHandlers): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${window.location.host}/ws/pipeline`);

  ws.onopen = () => handlers.onOpen?.();

  ws.onmessage = (evt: MessageEvent) => {
    try {
      const msg = JSON.parse(evt.data as string) as { type: string; data?: Record<string, unknown> };
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'ping' }));
        return;
      }
      handlers.onMessage(msg.type, msg.data ?? {});
    } catch { /* ignore malformed frames */ }
  };

  ws.onerror = () => handlers.onError?.();
  ws.onclose = () => handlers.onClose?.();

  return ws;
}
