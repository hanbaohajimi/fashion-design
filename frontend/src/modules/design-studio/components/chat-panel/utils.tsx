import React from 'react';
import {
  Sparkles,
  Wand2,
  Palette,
  ImageIcon,
  UserCircle,
  Shirt,
  Layers,
} from 'lucide-react';
import type { CapabilityId } from '../../utils/capabilities';
import type { ChatImage, StreamEvent, TrendHotItem } from './types';

export const MAX_ATTACHMENTS = 12;
export const MODEL_DISPLAY = 'Fashion AI';

export const TYPE_LABEL: Record<string, { label: string; icon: React.ReactNode }> = {
  text_to_image: { label: '文生图', icon: <Sparkles className="w-3 h-3" strokeWidth={1.5} /> },
  draw_sketch: { label: '草图', icon: <Wand2 className="w-3 h-3" strokeWidth={1.5} /> },
  edit_image: { label: '编辑', icon: <Palette className="w-3 h-3" strokeWidth={1.5} /> },
  transfer_pattern: { label: '图案', icon: <ImageIcon className="w-3 h-3" strokeWidth={1.5} /> },
  generate_model: { label: '模特', icon: <UserCircle className="w-3 h-3" strokeWidth={1.5} /> },
  try_on: { label: '试穿', icon: <Shirt className="w-3 h-3" strokeWidth={1.5} /> },
};

export const WELCOME_ICON_MAP: Record<CapabilityId, React.ReactNode> = {
  text_to_image: <Sparkles className="w-4 h-4" strokeWidth={1.5} />,
  draw_sketch: <Wand2 className="w-4 h-4" strokeWidth={1.5} />,
  edit_image: <Palette className="w-4 h-4" strokeWidth={1.5} />,
  transfer_pattern: <Layers className="w-4 h-4" strokeWidth={1.5} />,
  generate_model: <UserCircle className="w-4 h-4" strokeWidth={1.5} />,
  try_on: <Shirt className="w-4 h-4" strokeWidth={1.5} />,
};

export const TREND_DIM_ORDER = [
  'colors',
  'fabrics',
  'items',
  'silhouettes',
  'patterns',
  'style_keywords',
  'consumer_signals',
] as const;

export const TREND_DIM_LABELS: Record<string, string> = {
  colors: '色彩',
  fabrics: '面料',
  items: '单品',
  silhouettes: '廓形',
  patterns: '图案',
  style_keywords: '风格词',
  consumer_signals: '消费信号',
};

/** Vite 代理在目标不可达时常返回 502 */
export function designApiFailureMessage(status: number, statusText: string): string {
  const st = (statusText || '').trim() || '请求失败';
  if (status === 502 || status === 503) {
    return `HTTP ${status}（代理连不上设计后端 127.0.0.1:8001）。请在项目根执行 python start.py，或进入 backend\\services\\design-studio 执行 python run.py；并确认 FASHION_DESIGN_BACKEND 指向含 server.py 的目录。`;
  }
  if (status === 504) {
    return `HTTP ${status}（${st}）：设计后端响应超时。`;
  }
  if (status === 500) {
    return 'HTTP 500：设计服务内部错误，请查看运行设计后端的终端日志。';
  }
  return `HTTP ${status}: ${st}`;
}

export function formatApiDetail(body: unknown, fallback: string): string {
  const d = (body as { detail?: unknown })?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length > 0) {
    const first = d[0] as { msg?: string };
    if (typeof first?.msg === 'string') return first.msg;
  }
  return fallback;
}

export function extractMessageTitle(content: string): string | null {
  const bold = content.match(/\*\*(.+?)\*\*/);
  if (bold) return bold[1].trim();
  return null;
}

export function formatMessageDate(d: Date): string {
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtContent(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i} className="font-semibold" style={{ color: 'var(--color-ink)' }}>
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export function fmtLine(line: string, i: number): React.ReactNode {
  const num = line.match(/^(\d+)\.\s+(.+)/);
  if (num)
    return (
      <div key={i} className="flex gap-2 items-start py-0.5">
        <span
          className="numeral"
          style={{
            fontSize: 12,
            color: 'var(--color-ink-3)',
            minWidth: 20,
            paddingTop: 2,
          }}
        >
          {num[1]}.
        </span>
        <span className="flex-1">{fmtContent(num[2])}</span>
      </div>
    );
  const bul = line.match(/^[-•]\s+(.+)/);
  if (bul)
    return (
      <div key={i} className="flex gap-2 items-start py-0.5">
        <span
          style={{
            width: 4,
            height: 1,
            background: 'var(--color-ink-3)',
            marginTop: 10,
            flexShrink: 0,
          }}
        />
        <span className="flex-1">{fmtContent(bul[1])}</span>
      </div>
    );
  return (
    <React.Fragment key={i}>
      {i > 0 && <br />}
      {fmtContent(line)}
    </React.Fragment>
  );
}

export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 150, 300].map(d => (
        <span
          key={d}
          className="chat-dot"
          style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            background: 'var(--color-ink-3)',
            animationDelay: `${d}ms`,
          }}
        />
      ))}
    </span>
  );
}

/** 解析趋势服务 /api/trend/trends/hot 的多种可能 JSON 结构（保留维度分类） */
export function parseTrendHotItems(data: unknown): TrendHotItem[] {
  const out: TrendHotItem[] = [];

  const pushObj = (o: Record<string, unknown>) => {
    const raw = o.word ?? o.keyword ?? o.term ?? o.name ?? o.text ?? o.label ?? o.title ?? o.key;
    if (typeof raw !== 'string' || !raw.trim()) return;
    const catRaw = o.category;
    const cat = typeof catRaw === 'string' && catRaw.trim() ? catRaw.trim() : 'style_keywords';
    const count =
      typeof o.count === 'number'
        ? o.count
        : typeof o.count === 'string'
          ? Number(o.count) || 0
          : 0;
    const labRaw = o.category_label ?? o.categoryLabel;
    const categoryLabel =
      typeof labRaw === 'string' && labRaw.trim()
        ? labRaw.trim()
        : TREND_DIM_LABELS[cat] || cat;
    out.push({ keyword: raw.trim(), count, category: cat, categoryLabel });
  };

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string' && item.trim()) {
        out.push({ keyword: item.trim(), count: 0, category: 'other', categoryLabel: '其他' });
      } else if (item && typeof item === 'object') {
        pushObj(item as Record<string, unknown>);
      }
    }
    const dedup = new Map<string, TrendHotItem>();
    for (const it of out) {
      const k = `${it.category}::${it.keyword}`;
      const ex = dedup.get(k);
      if (!ex || ex.count < it.count) dedup.set(k, it);
    }
    return [...dedup.values()].sort((a, b) => b.count - a.count);
  }
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const keys = ['items', 'words', 'data', 'trends', 'hot', 'keywords', 'list', 'results'];
    for (const k of keys) {
      const v = d[k];
      if (Array.isArray(v)) return parseTrendHotItems(v);
    }
    if (typeof d.total === 'number' && Array.isArray((d as { rows?: unknown }).rows)) {
      return parseTrendHotItems((d as { rows: unknown[] }).rows);
    }
  }
  return [];
}

export async function fetchTrendHotItems(
  category: string,
  signal?: AbortSignal,
): Promise<TrendHotItem[]> {
  let url = '/api/trend/trends/hot?limit=120';
  if (category) url += `&category=${encodeURIComponent(category)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json: unknown = await res.json();
  return parseTrendHotItems(json);
}

export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
  authToken?: string,
  mode?: string,
  designerProjectId?: string | null,
  trendId?: string,
  trendEnabled?: boolean,
) {
  const res = await fetch('/api/design/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      ...(authToken ? { auth_token: authToken } : {}),
      mode: mode || 'personal',
      designer_project_id: designerProjectId || undefined,
      trend_id: trendId || undefined,
      trend_enabled: trendEnabled ?? false,
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(designApiFailureMessage(res.status, res.statusText));
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';

  const emitLine = (raw: string) => {
    let line = raw.replace(/\r$/, '').trim();
    if (!line) return;
    if (line.startsWith('data:')) line = line.slice(5).trim();
    if (!line || line === '[DONE]') return;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    const t = (obj as { type?: unknown }).type;
    if (typeof t !== 'string') return;
    onEvent(obj as StreamEvent);
  };

  const drainBuffer = () => {
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      emitLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    drainBuffer();
  }
  buf += dec.decode();
  drainBuffer();
  emitLine(buf);
}

export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || 'image/png' });
}

export function isImageFile(f: File): boolean {
  if (f.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|heic|bmp)$/i.test(f.name);
}
