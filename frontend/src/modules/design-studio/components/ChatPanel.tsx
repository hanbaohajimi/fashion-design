import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Send,
  Paperclip,
  Sparkles,
  Shirt,
  Download,
  Loader2,
  X,
  User,
  RotateCcw,
  StopCircle,
  Copy,
  Check,
  RefreshCw,
  Clock,
  ImageIcon,
  Palette,
  UserCircle,
  Wand2,
  PencilRuler,
  Upload,
  ArrowRight,
  Layers,
  ChevronLeft,
  ChevronRight,
  AtSign,
  Share2,
  SquarePlus,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  LayoutGrid,
  Lightbulb,
  Zap,
  Globe,
  Box,
  Eye,
  TrendingUp,
} from 'lucide-react';
import { useToast } from '../../../components/Toast';

const MAX_ATTACHMENTS = 12;

interface LocalAttachment {
  localId: string;
  file: File;
  preview: string;
  displayName: string;
}

interface ChatImage {
  url: string;
  type: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: ChatImage[];
  timestamp: Date;
  isStreaming?: boolean;
  status?: string;
  uploadPreview?: string;
  uploadPreviews?: string[];
  isError?: boolean;
  failedMessage?: string;
}

interface StreamEvent {
  type: 'status' | 'image' | 'message' | 'error' | 'done';
  content?: string;
  url?: string;
  images?: ChatImage[];
  [key: string]: unknown;
}

/** Vite 代理在目标不可达时常返回 502 */
function designApiFailureMessage(status: number, statusText: string): string {
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

interface ChatPanelProps {
  onEditImage: (imageUrl: string) => void;
  onPreviewImage: (imageUrl: string) => void;
  onImageGenerated?: (image: ChatImage) => void;
  onAddToCanvas?: (imageUrl: string) => void;
  pendingFromCanvas?: string | null;
  onClearPendingFromCanvas?: () => void;
  /** 同步当前对话 session_id，供像素编辑等调用后端时写入同一会话目录 */
  onSessionIdChange?: (sessionId: string) => void;
  /** 外部控制的 session_id（个性化模式由 Workspace 预创建） */
  externalSessionId?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  side?: 'left' | 'right';
  authToken?: string;
  mode?: 'personal' | 'designer';
  designerProjectId?: string | null;
  trendId?: string;
  trendEnabled?: boolean;
  onTrendToggle?: (trendId: string | undefined, enabled: boolean) => void;
  modeBar?: React.ReactNode;
  settingsButton?: React.ReactNode;
}

const TYPE_LABEL: Record<string, { label: string; icon: React.ReactNode }> = {
  text_to_image: { label: '文生图', icon: <Sparkles className="w-3 h-3" /> },
  draw_sketch: { label: '草图', icon: <Wand2 className="w-3 h-3" /> },
  edit_image: { label: '编辑', icon: <Palette className="w-3 h-3" /> },
  transfer_pattern: { label: '图案', icon: <ImageIcon className="w-3 h-3" /> },
  generate_model: { label: '模特', icon: <UserCircle className="w-3 h-3" /> },
  try_on: { label: '试穿', icon: <Shirt className="w-3 h-3" /> },
};

const WELCOME_CARDS = [
  {
    icon: <Wand2 className="w-4 h-4" />,
    title: '设计草图',
    sub: '从零开始绘制服装线稿',
    prompt: '设计一件红色晚礼服款式线稿，正面视图，线条清晰，留白背景',
  },
  {
    icon: <Palette className="w-4 h-4" />,
    title: '渲染编辑',
    sub: '将草图渲染为成品效果',
    prompt: '把我上传的服装线稿渲染成写实成衣效果图，面料质感自然，棚拍柔光',
  },
  {
    icon: <Layers className="w-4 h-4" />,
    title: '图案迁移',
    sub: '将花纹 / Logo 应用到服装',
    prompt: '把上传的参考图案迁移到这件服装上，保持款式不变，图案随衣身褶皱自然变形',
  },
  {
    icon: <UserCircle className="w-4 h-4" />,
    title: '虚拟试穿',
    sub: '把服装穿到模特身上展示',
    prompt: '把这件服装虚拟穿到模特身上，全身展示，自然站姿，中性棚拍光线',
  },
];

const TREND_DIM_ORDER = [
  'colors',
  'fabrics',
  'items',
  'silhouettes',
  'patterns',
  'style_keywords',
  'consumer_signals',
] as const;

const TREND_DIM_LABELS: Record<string, string> = {
  colors: '色彩',
  fabrics: '面料',
  items: '单品',
  silhouettes: '廓形',
  patterns: '图案',
  style_keywords: '风格词',
  consumer_signals: '消费信号',
};

type TrendHotItem = {
  keyword: string;
  count: number;
  category: string;
  categoryLabel: string;
};

/** 解析趋势服务 /api/trend/trends/hot 的多种可能 JSON 结构（保留维度分类） */
function parseTrendHotItems(data: unknown): TrendHotItem[] {
  const out: TrendHotItem[] = [];

  const pushObj = (o: Record<string, unknown>) => {
    const raw =
      o.word ?? o.keyword ?? o.term ?? o.name ?? o.text ?? o.label ?? o.title ?? o.key;
    if (typeof raw !== 'string' || !raw.trim()) return;
    const catRaw = o.category;
    const cat =
      typeof catRaw === 'string' && catRaw.trim() ? catRaw.trim() : 'style_keywords';
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
    out.push({
      keyword: raw.trim(),
      count,
      category: cat,
      categoryLabel,
    });
  };

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string' && item.trim()) {
        out.push({
          keyword: item.trim(),
          count: 0,
          category: 'other',
          categoryLabel: '其他',
        });
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

async function fetchTrendHotItems(
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

function getContextSuggestions(t?: string): string[] {
  switch (t) {
    case 'text_to_image':
      return ['换个背景或光线', '生成配套单品', '改成线稿款式图', '生成模特试穿'];
    case 'draw_sketch':
      return ['把它渲染为真实照片', '修改颜色为蓝色', '生成一个女模特', '修改为短裙款式'];
    case 'edit_image':
      return ['继续调整细节', '换个颜色试试', '生成模特来试穿', '再设计一件新的'];
    case 'generate_model':
      return ['把当前设计穿到模特身上', '换个男模特', '修改模特造型'];
    case 'try_on':
      return ['换个角度看看', '修改服装颜色', '换一个模特', '再设计一件新的'];
    case 'transfer_pattern':
      return ['调整图案位置', '换个颜色', '生成模特试穿'];
    default:
      return [];
  }
}

async function streamChat(
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

async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || 'image/png' });
}

function isImageFile(f: File): boolean {
  if (f.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|heic|bmp)$/i.test(f.name);
}

function formatApiDetail(body: unknown, fallback: string): string {
  const d = (body as { detail?: unknown })?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length > 0) {
    const first = d[0] as { msg?: string };
    if (typeof first?.msg === 'string') return first.msg;
  }
  return fallback;
}

const MODEL_DISPLAY = 'Fashion AI';

function extractMessageTitle(content: string): string | null {
  const bold = content.match(/\*\*(.+?)\*\*/);
  if (bold) return bold[1].trim();
  return null;
}

function formatMessageDate(d: Date): string {
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtContent(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i} className="font-semibold text-gray-900">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function fmtLine(line: string, i: number): React.ReactNode {
  const num = line.match(/^(\d+)\.\s+(.+)/);
  if (num)
    return (
      <div key={i} className="flex gap-2 items-start py-0.5">
        <span className="text-[10px] font-semibold text-gray-400 w-4 h-4 rounded flex items-center justify-center shrink-0 mt-0.5">
          {num[1]}.
        </span>
        <span className="flex-1">{fmtContent(num[2])}</span>
      </div>
    );
  const bul = line.match(/^[-•]\s+(.+)/);
  if (bul)
    return (
      <div key={i} className="flex gap-2 items-start py-0.5">
        <span className="w-1 h-1 rounded-full bg-gray-300 shrink-0 mt-[7px]" />
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

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      {[0, 150, 300].map((d) => (
        <span
          key={d}
          className="chat-dot w-1 h-1 rounded-full bg-gray-400"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </span>
  );
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  onEditImage,
  onPreviewImage,
  onImageGenerated,
  onAddToCanvas,
  pendingFromCanvas = null,
  onClearPendingFromCanvas,
  onSessionIdChange,
  externalSessionId,
  collapsed = false,
  onToggleCollapse,
  side = 'left',
  authToken,
  mode = 'personal',
  designerProjectId,
  trendId,
  trendEnabled: trendEnabledProp = false,
  onTrendToggle,
  modeBar,
  settingsButton,
}) => {
  const isRight = side === 'right';
  const edgeBorder = isRight ? 'border-l' : 'border-r';
  const CollapseIcon = isRight ? ChevronRight : ChevronLeft;
  const ExpandIcon = isRight ? ChevronLeft : ChevronRight;

  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => externalSessionId || crypto.randomUUID());

  // Sync external session id (set by Workspace when a personalized session is created)
  useEffect(() => {
    if (externalSessionId && externalSessionId !== sessionId) {
      setSessionId(externalSessionId);
    }
  }, [externalSessionId]);

  useEffect(() => {
    onSessionIdChange?.(sessionId);
  }, [sessionId, onSessionIdChange]);
  const [attachedAssets, setAttachedAssets] = useState<LocalAttachment[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [msgFeedback, setMsgFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const [lastImageType, setLastImageType] = useState<string | undefined>();
  const [isDragging, setIsDragging] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [trendActive, setTrendActive] = useState(trendEnabledProp);
  const [enhancing, setEnhancing] = useState(false);
  const [trendHotItems, setTrendHotItems] = useState<TrendHotItem[]>([]);
  const [trendHotCategory, setTrendHotCategory] = useState('');
  const [trendHotStatus, setTrendHotStatus] = useState<'loading' | 'ok' | 'empty' | 'error'>('loading');

  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragCnt = useRef(0);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  const scroll = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
  }, []);
  useEffect(() => {
    scroll();
  }, [messages, scroll]);

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = 'auto';
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  useEffect(() => {
    if (pendingFromCanvas) taRef.current?.focus();
  }, [pendingFromCanvas]);

  const loadTrendHotTags = useCallback(async () => {
    setTrendHotStatus('loading');
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 8000);
    try {
      const items = await fetchTrendHotItems(trendHotCategory, ac.signal);
      window.clearTimeout(timer);
      setTrendHotItems(items);
      setTrendHotStatus(items.length ? 'ok' : 'empty');
    } catch {
      window.clearTimeout(timer);
      setTrendHotItems([]);
      setTrendHotStatus('error');
    }
  }, [trendHotCategory]);

  useEffect(() => {
    void loadTrendHotTags();
  }, [loadTrendHotTags]);

  const trendHotDisplayBlocks = useMemo(() => {
    if (!trendHotItems.length) return [];
    const perGroup = trendHotCategory ? 28 : 10;
    if (trendHotCategory) {
      return [
        {
          key: trendHotCategory,
          label: TREND_DIM_LABELS[trendHotCategory] || trendHotCategory,
          items: trendHotItems.slice(0, perGroup),
        },
      ];
    }
    const byCat = new Map<string, TrendHotItem[]>();
    for (const it of trendHotItems) {
      const c = it.category || 'other';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c)!.push(it);
    }
    const blocks: { key: string; label: string; items: TrendHotItem[] }[] = [];
    for (const cat of TREND_DIM_ORDER) {
      const list = byCat.get(cat);
      if (list?.length) {
        blocks.push({
          key: cat,
          label: TREND_DIM_LABELS[cat] || cat,
          items: list.slice(0, perGroup),
        });
      }
    }
    for (const [cat, list] of byCat) {
      if ((TREND_DIM_ORDER as readonly string[]).includes(cat)) continue;
      blocks.push({
        key: cat,
        label: list[0]?.categoryLabel || cat,
        items: list.slice(0, perGroup),
      });
    }
    return blocks;
  }, [trendHotItems, trendHotCategory]);

  useEffect(() => {
    if (!mentionOpen) return;
    const close = (e: MouseEvent) => {
      if (
        mentionMenuRef.current &&
        !mentionMenuRef.current.contains(e.target as Node) &&
        taRef.current &&
        !taRef.current.contains(e.target as Node)
      ) {
        setMentionOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [mentionOpen]);

  const revokeAttachmentPreview = useCallback((a: LocalAttachment) => {
    if (a.preview.startsWith('blob:')) URL.revokeObjectURL(a.preview);
  }, []);

  const clearAttachedAssets = useCallback(() => {
    setAttachedAssets((prev) => {
      prev.forEach(revokeAttachmentPreview);
      return [];
    });
  }, [revokeAttachmentPreview]);

  const getMentionTargets = useCallback(() => {
    const items: { n: number; name: string }[] = [];
    let n = 1;
    if (pendingFromCanvas) {
      items.push({ n, name: '画布参考' });
      n += 1;
    }
    for (const a of attachedAssets) {
      const short = a.displayName.replace(/\.[^/.]+$/, '');
      items.push({ n, name: short.length > 24 ? `${short.slice(0, 22)}…` : short });
      n += 1;
    }
    return items;
  }, [pendingFromCanvas, attachedAssets]);

  const attachMany = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files).filter(isImageFile);
      if (list.length === 0) {
        toast('请选择图片文件', 'error');
        return;
      }
      setAttachedAssets((prev) => {
        const next = [...prev];
        for (const f of list) {
          if (f.size > 20 * 1024 * 1024) {
            toast(`${f.name} 超过 20MB，已跳过`, 'error');
            continue;
          }
          if (next.length >= MAX_ATTACHMENTS) {
            toast(`最多添加 ${MAX_ATTACHMENTS} 张图片`, 'error');
            break;
          }
          next.push({
            localId: crypto.randomUUID(),
            file: f,
            preview: URL.createObjectURL(f),
            displayName: f.name,
          });
        }
        return next;
      });
    },
    [toast],
  );

  const removeAttachment = useCallback(
    (localId: string) => {
      setAttachedAssets((prev) => {
        const a = prev.find((x) => x.localId === localId);
        if (a) revokeAttachmentPreview(a);
        return prev.filter((x) => x.localId !== localId);
      });
    },
    [revokeAttachmentPreview],
  );

  const newChat = async () => {
    if (messages.length > 0) {
      const ok = window.confirm(
        '确定开始新对话？当前界面中的会话记录将被清空，服务器会话也会重置。',
      );
      if (!ok) return;
    }
    if (isLoading) {
      abortRef.current?.abort();
      setIsLoading(false);
    }
    const id = crypto.randomUUID();
    setSessionId(id);
    setMessages([]);
    setInput('');
    setLastImageType(undefined);
    clearAttachedAssets();
    toast('已开始新对话', 'info');
    try {
      await fetch('/api/design/session/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: id }),
      });
    } catch {
      /* */
    }
    onClearPendingFromCanvas?.();
    taRef.current?.focus();
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fs = e.target.files;
    if (fs?.length) attachMany(fs);
    e.target.value = '';
  };

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCnt.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCnt.current--;
    if (dragCnt.current === 0) setIsDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCnt.current = 0;
    const fs = e.dataTransfer.files;
    if (fs?.length) {
      attachMany(fs);
      toast('图片已添加', 'success');
    }
  };

  const copyText = (t: string, id: string) => {
    navigator.clipboard.writeText(t);
    setCopiedId(id);
    toast('已复制', 'success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const shareConversation = useCallback(() => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    void navigator.clipboard.writeText(url);
    toast('页面链接已复制', 'success');
  }, [toast]);

  const lastAssistantImageUrl = messages
    .filter((m) => m.role === 'assistant' && m.images?.length)
    .map((m) => m.images![m.images!.length - 1].url)
    .pop();

  const addToLibrary = useCallback(() => {
    if (!lastAssistantImageUrl) {
      toast('暂无可收藏的图片', 'info');
      return;
    }
    void navigator.clipboard.writeText(
      lastAssistantImageUrl.startsWith('http') ? lastAssistantImageUrl : `${window.location.origin}${lastAssistantImageUrl}`,
    );
    toast('最新生成图链接已复制', 'success');
  }, [lastAssistantImageUrl, toast]);

  const chatSessionTitle = (() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser?.content) return '新对话';
    const t = lastUser.content.replace(/\s+/g, ' ').trim();
    return t.length > 28 ? `${t.slice(0, 26)}…` : t;
  })();

  const insertMention = useCallback(
    (figLabel: string) => {
      const el = taRef.current;
      const pos = el?.selectionStart ?? input.length;
      const before = input.slice(0, pos);
      const at = before.lastIndexOf('@');
      if (at === -1) return;
      const newInput = `${input.slice(0, at)}@${figLabel} ${input.slice(pos)}`;
      setInput(newInput);
      setMentionOpen(false);
      setMentionFilter('');
      requestAnimationFrame(() => {
        if (!el) return;
        const np = at + 1 + figLabel.length + 1;
        el.focus();
        el.setSelectionRange(np, np);
      });
    },
    [input],
  );

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setInput(v);
    const pos = e.target.selectionStart ?? v.length;
    const before = v.slice(0, pos);
    const m = before.match(/@([\u4e00-\u9fff\w.]*)$/);
    if (m && getMentionTargets().length > 0) {
      setMentionOpen(true);
      setMentionFilter(m[1] ?? '');
    } else {
      setMentionOpen(false);
      setMentionFilter('');
    }
  };

  const enhanceInput = async () => {
    const raw = input.trim();
    if (!raw) { toast('请先输入内容再增强', 'info'); return; }
    setEnhancing(true);
    try {
      const res = await fetch('/api/design/enhance-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: raw, style: '' }),
      });
      if (!res.ok) throw new Error(designApiFailureMessage(res.status, res.statusText));
      const data = await res.json();
      if (data.enhanced && data.enhanced !== raw) {
        setInput(data.enhanced);
        toast('提示词已增强', 'success');
      } else {
        toast('提示词已是最优状态', 'info');
      }
    } catch {
      toast('提示词增强服务暂不可用', 'error');
    } finally {
      setEnhancing(false);
    }
  };

  const send = async (direct?: string) => {
    const rawTxt = direct || input.trim();
    const txt = rawTxt + (fastMode && rawTxt ? ' [请简洁快速回复，不必详细解释]' : '');
    const hasCanvas = !!pendingFromCanvas;
    const hasFiles = attachedAssets.length > 0;
    if ((!txt && !hasFiles && !hasCanvas) || isLoading) return;

    const filesToUpload: File[] = [];
    if (hasCanvas) {
      try {
        filesToUpload.push(await dataUrlToFile(pendingFromCanvas!, 'canvas-reference.png'));
      } catch {
        toast('画布图片处理失败，请重试', 'error');
        return;
      }
    }
    for (const a of attachedAssets) filesToUpload.push(a.file);

    const uploadPreviews: string[] = [];
    if (pendingFromCanvas) uploadPreviews.push(pendingFromCanvas);
    for (const a of attachedAssets) uploadPreviews.push(a.preview);

    const uMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: txt || '(上传图片)',
      timestamp: new Date(),
      ...(uploadPreviews.length > 1
        ? { uploadPreviews }
        : uploadPreviews.length === 1
          ? { uploadPreview: uploadPreviews[0] }
          : {}),
    };
    const aId = crypto.randomUUID();
    const aMsg: ChatMessage = {
      id: aId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
      status: '连接中...',
    };
    setMessages((p) => [...p, uMsg, aMsg]);
    if (!direct) setInput('');
    setMentionOpen(false);
    setIsLoading(true);

    if (filesToUpload.length > 0) {
      try {
        const fd = new FormData();
        fd.append('session_id', sessionId);
        for (const f of filesToUpload) fd.append('files', f);
        const res = await fetch('/api/design/upload', { method: 'POST', body: fd });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const msg =
            res.status === 502 || res.status === 503
              ? designApiFailureMessage(res.status, res.statusText)
              : formatApiDetail(err, `${res.status} ${res.statusText}`);
          console.error('[upload]', res.status, err);
          throw new Error(msg);
        }
        clearAttachedAssets();
        onClearPendingFromCanvas?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : '网络异常';
        toast(msg ? `图片上传失败：${msg}` : '图片上传失败', 'error');
        setMessages((p) => p.filter((m) => m.id !== uMsg.id && m.id !== aId));
        setIsLoading(false);
        abortRef.current = null;
        return;
      }
    }

    const imgs: ChatImage[] = [];
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let imgLoading = false;

    const IMG_PHASE_HINTS = [
      '正在绘制',
      '正在编辑',
      '正在图案',
      '正在生成模特',
      '正在虚拟',
      '正在文生图',
      '正在生图',
      '生成中',
      '排队',
      '调用',
    ];

    let lastAppliedStatus = '';
    let statusRaf: number | null = null;
    let pendingStatus: string | undefined;

    const flushPendingStatus = () => {
      if (statusRaf != null) {
        cancelAnimationFrame(statusRaf);
        statusRaf = null;
      }
      const s = pendingStatus;
      pendingStatus = undefined;
      if (s === undefined || s === lastAppliedStatus) return;
      lastAppliedStatus = s;
      setMessages((p) => p.map((m) => (m.id === aId ? { ...m, status: s } : m)));
    };

    const queueStatus = (s: string) => {
      pendingStatus = s;
      if (statusRaf != null) return;
      statusRaf = requestAnimationFrame(() => {
        statusRaf = null;
        const next = pendingStatus;
        pendingStatus = undefined;
        if (next === undefined || next === lastAppliedStatus) return;
        lastAppliedStatus = next;
        setMessages((p) => p.map((m) => (m.id === aId ? { ...m, status: next } : m)));
      });
    };

    try {
      await streamChat(sessionId, uMsg.content, (ev) => {
        switch (ev.type) {
          case 'status': {
            const s = (ev.content || '').trim();
            if (IMG_PHASE_HINTS.some((k) => s.includes(k)) && !imgLoading) imgLoading = true;
            if (s) queueStatus(s);
            break;
          }
          case 'image':
            flushPendingStatus();
            if (ev.url) {
              const url = ev.url as string;
              if (imgs.some((x) => x.url === url)) break;
              const ex = ev as Record<string, unknown>;
              const t =
                (typeof ex.image_type === 'string' && ex.image_type) ||
                (typeof ex.capability === 'string' && ex.capability) ||
                (typeof ex.tool === 'string' && ex.tool) ||
                'image';
              const ni = { url, type: t };
              imgs.push(ni);
              setLastImageType(t);
              onImageGenerated?.(ni);
              imgLoading = false;
              setMessages((p) => p.map((m) => (m.id === aId ? { ...m, images: [...imgs] } : m)));
            }
            break;
          case 'message':
            flushPendingStatus();
            setMessages((p) =>
              p.map((m) =>
                m.id === aId
                  ? {
                      ...m,
                      content: (ev.content as string) || '',
                      images: (ev.images as ChatImage[]) || imgs,
                      isStreaming: false,
                      status: undefined,
                    }
                  : m,
              ),
            );
            break;
          case 'error':
            flushPendingStatus();
            setMessages((p) =>
              p.map((m) =>
                m.id === aId
                  ? {
                      ...m,
                      content: `${ev.content}`,
                      isStreaming: false,
                      status: undefined,
                      isError: true,
                      failedMessage: uMsg.content,
                    }
                  : m,
              ),
            );
            toast(`${ev.content}`, 'error');
            break;
          case 'done':
            flushPendingStatus();
            setMessages((p) =>
              p.map((m) => (m.id === aId ? { ...m, isStreaming: false, status: undefined } : m)),
            );
            break;
        }
      }, ctrl.signal, authToken, mode, designerProjectId, trendId, trendActive);
    } catch (err: unknown) {
      if (statusRaf != null) {
        cancelAnimationFrame(statusRaf);
        statusRaf = null;
      }
      pendingStatus = undefined;
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((p) =>
          p.map((m) =>
            m.id === aId
              ? {
                  ...m,
                  content:
                    err.message.includes('500') ? err.message : `连接失败: ${err.message}`,
                  isStreaming: false,
                  status: undefined,
                  isError: true,
                  failedMessage: uMsg.content,
                }
              : m,
          ),
        );
        toast('连接后端失败', 'error');
      } else {
        setMessages((p) =>
          p.map((m) =>
            m.id === aId
              ? { ...m, content: '已取消生成', isStreaming: false, status: undefined }
              : m,
          ),
        );
      }
    }
    setIsLoading(false);
    abortRef.current = null;
    taRef.current?.focus();
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape' && mentionOpen) {
      e.preventDefault();
      setMentionOpen(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const retry = (msg: string) => {
    setMessages((p) => {
      const l = p.length - 1;
      return l >= 1 ? p.slice(0, l - 1) : p;
    });
    setTimeout(() => send(msg), 50);
  };

  const suggest = (t: string) => {
    setInput(t);
    taRef.current?.focus();
  };

  const applyTrendHotTag = (word: string) => {
    suggest(
      `结合「${word}」流行趋势热点，设计一件女装方向的概念成衣效果图，造型完整清晰、中性棚拍柔光、突出该趋势风格特征`,
    );
  };

  const dlImg = (u: string) => {
    const a = document.createElement('a');
    a.href = u;
    a.download = `design-${Date.now()}.png`;
    a.click();
    toast('开始下载', 'success');
  };

  const ctx = getContextSuggestions(lastImageType);
  const showWelcome = messages.length === 0 && !isLoading;
  const showCtx = !isLoading && ctx.length > 0 && messages.length > 0;
  const hasActivity =
    isLoading || messages.length > 0 || !!pendingFromCanvas || attachedAssets.length > 0;

  const mentionTargets = getMentionTargets();
  const filteredMentions = mentionFilter
    ? mentionTargets.filter(
        (t) =>
          `图${t.n}`.includes(mentionFilter) ||
          t.name.toLowerCase().includes(mentionFilter.toLowerCase()),
      )
    : mentionTargets;

  if (collapsed) {
    return (
      <div
        className={`w-12 min-w-12 shrink-0 h-full bg-white ${edgeBorder} border-gray-200/60 z-20 flex flex-col items-center py-3 gap-2 transition-[width,min-width] duration-200 ease-out`}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          title="展开 AI 对话（Ctrl+B）"
          className="p-2 rounded-xl bg-gray-900 text-white hover:bg-gray-800 transition-colors shadow-sm"
        >
          <ExpandIcon className="w-4 h-4" />
        </button>
        <div className="flex flex-col items-center gap-1.5 mt-1 min-h-[24px]">
          {isLoading && (
            <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" aria-label="生成中" />
          )}
          {!isLoading && hasActivity && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-emerald-500"
              title="有进行中的会话或待发送参考图"
            />
          )}
        </div>
        <span
          className="mt-2 text-[10px] font-medium text-gray-400 tracking-wider"
          style={{ writingMode: 'vertical-rl' }}
        >
          对话
        </span>
      </div>
    );
  }

  return (
    <div
      className={`shrink-0 bg-white flex flex-col h-full ${edgeBorder} border-gray-200/60 z-20 relative transition-[width,min-width] duration-200 ease-out overflow-x-hidden w-[clamp(420px,38vw,600px)] min-w-[380px] max-w-[min(600px,calc(100vw-320px))]`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-white/95 backdrop-blur flex items-center justify-center border border-dashed border-gray-300 rounded-lg m-3">
          <div className="text-center">
            <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-600 font-medium">松开上传图片</p>
          </div>
        </div>
      )}

      <div className="px-4 py-3 border-b border-gray-100 bg-white">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-[13px] font-semibold text-gray-900 tracking-tight truncate">Fashion Studio</h1>
              <p className="text-[10px] text-gray-400 truncate">AI 设计助手</p>
              {messages.length > 0 && (
                <p className="text-[11px] font-medium text-gray-500 truncate mt-0.5" title={chatSessionTitle}>
                  {chatSessionTitle}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {settingsButton}
            <button
              type="button"
              onClick={addToLibrary}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              title="复制最近生成图链接"
            >
              <SquarePlus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={shareConversation}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              title="复制页面链接"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={newChat}
              className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              title="新对话"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                title="收起侧栏（Ctrl+B）"
              >
                <CollapseIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {modeBar}

      <div className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 chat-scrollbar min-w-0">
        {showWelcome && (
          <div className="fade-up-in">
            <div className="mb-8 mt-6">
              <h2 className="text-[15px] font-semibold text-gray-900 tracking-tight mb-1">你好，设计师</h2>
              <p className="text-[13px] text-gray-400 leading-relaxed">描述你的设计需求，AI 将为你创作</p>
            </div>
            <div className="space-y-1.5">
              {WELCOME_CARDS.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => suggest(c.prompt)}
                  className="w-full group flex items-center gap-3 px-3.5 py-3 rounded-xl hover:bg-gray-50 transition-colors text-left"
                >
                  <span className="w-8 h-8 rounded-lg bg-gray-50 group-hover:bg-gray-100 flex items-center justify-center text-gray-400 group-hover:text-gray-600 transition-colors shrink-0">
                    {c.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-gray-700 group-hover:text-gray-900">{c.title}</p>
                    <p className="text-[11px] text-gray-400 truncate">{c.sub}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-400 group-hover:translate-x-0.5 transition-all shrink-0" />
                </button>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-gray-200/90 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-gray-100/90 bg-gradient-to-r from-violet-50/70 via-white to-amber-50/35">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0 shadow-sm">
                    <TrendingUp className="w-4 h-4 text-white" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-gray-900 tracking-tight">趋势分析</p>
                    <p className="text-[10px] text-gray-500 truncate">按维度热词 · 选分类后刷新列表 · 点击填入提示词</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadTrendHotTags()}
                  disabled={trendHotStatus === 'loading'}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-gray-500 hover:text-gray-800 hover:bg-white/80 rounded-lg transition-colors disabled:opacity-50"
                  title="重新拉取热词"
                >
                  <RefreshCw className={`w-3 h-3 ${trendHotStatus === 'loading' ? 'animate-spin' : ''}`} />
                  刷新
                </button>
              </div>
              <div className="px-3.5 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="trend-hot-cat-welcome" className="text-[10px] text-gray-500 shrink-0">
                    维度
                  </label>
                  <select
                    id="trend-hot-cat-welcome"
                    value={trendHotCategory}
                    onChange={(e) => setTrendHotCategory(e.target.value)}
                    disabled={trendHotStatus === 'loading'}
                    className="text-[11px] rounded-lg border border-gray-200/90 bg-white text-gray-800 px-2 py-1.5 min-w-[120px] max-w-full focus:outline-none focus:ring-1 focus:ring-violet-300 disabled:opacity-50"
                  >
                    <option value="">全部维度</option>
                    {TREND_DIM_ORDER.map((k) => (
                      <option key={k} value={k}>
                        {TREND_DIM_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                {trendHotStatus === 'loading' && (
                  <div className="flex items-center gap-2 text-[11px] text-gray-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden />
                    正在同步热词…
                  </div>
                )}
                {trendHotStatus === 'error' && (
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    无法连接趋势服务。请确认趋势分析后端（端口 8002）已启动，稍后点击「刷新」。
                  </p>
                )}
                {trendHotStatus === 'empty' && (
                  <p className="text-[11px] text-gray-400">暂无热词数据，可在趋势分析中心完成采集后再试。</p>
                )}
                {trendHotDisplayBlocks.length > 0 && (
                  <div className="space-y-3 max-h-[min(40vh,320px)] overflow-y-auto pr-0.5">
                    {trendHotDisplayBlocks.map((block) => (
                      <div key={block.key}>
                        {!trendHotCategory && (
                          <p className="text-[10px] font-semibold text-gray-500 tracking-wide mb-1.5">
                            {block.label}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {block.items.map((it) => (
                            <button
                              key={`${it.category}-${it.keyword}`}
                              type="button"
                              onClick={() => applyTrendHotTag(it.keyword)}
                              className="inline-flex items-center max-w-full px-2.5 py-1.5 rounded-full text-[11px] font-medium bg-gray-50 text-gray-700 border border-gray-200/80 hover:border-violet-300 hover:bg-violet-50/60 hover:text-violet-950 transition-colors truncate"
                              title={
                                it.count > 0
                                  ? `${it.keyword} · ${it.categoryLabel} · ${it.count} 次`
                                  : `${it.keyword} · ${it.categoryLabel}`
                              }
                            >
                              {it.keyword}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="space-y-8">
          {messages.map((msg) => {
            const assistantTitle =
              msg.role === 'assistant' && msg.content && !msg.isError
                ? extractMessageTitle(msg.content)
                : null;
            const previews = msg.uploadPreviews?.length
              ? msg.uploadPreviews
              : msg.uploadPreview
                ? [msg.uploadPreview]
                : [];

            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="chat-message-enter flex gap-2.5 flex-row-reverse group">
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-3.5 h-3.5 text-gray-500" />
                  </div>
                  <div className="max-w-[min(92%,420px)] flex flex-col items-end">
                    <div className="rounded-2xl border border-gray-200/90 bg-gray-50/95 text-gray-900 shadow-sm overflow-hidden w-full">
                      {previews.length > 0 && (
                        <div className="flex gap-2 px-3 pt-3 pb-2 overflow-x-auto border-b border-gray-200/60 scrollbar-thin">
                          {previews.map((src, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 pl-1 pr-2 py-1.5 bg-white rounded-xl border border-gray-200/80 shadow-sm shrink-0 min-w-0 max-w-[200px]"
                            >
                              <img src={src} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium text-gray-700 truncate">图{i + 1}</p>
                                <p className="text-[10px] text-gray-400 truncate">参考图</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="px-3.5 py-2.5 text-[13px] leading-relaxed">
                        {msg.content && (
                          <div className="space-y-0.5">{msg.content.split('\n').map((l, i) => fmtLine(l, i))}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            /* assistant / system */
            return (
              <div key={msg.id} className="chat-message-enter group">
                <div className="text-[11px] text-gray-400 mb-1">{formatMessageDate(msg.timestamp)}</div>
                <div className="flex items-center gap-1.5 text-[12px] text-gray-600 mb-2">
                  <Eye className="w-3.5 h-3.5 text-gray-400" />
                  <span className="font-semibold text-gray-800">{MODEL_DISPLAY}</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-400">设计助手</span>
                </div>

                {msg.isError ? (
                  <div className="rounded-2xl px-3.5 py-2.5 text-[13px] bg-red-50 text-red-600 border border-red-100">
                    {msg.content}
                    {msg.failedMessage && (
                      <button
                        type="button"
                        onClick={() => retry(msg.failedMessage!)}
                        className="flex items-center gap-1 mt-2 px-2.5 py-1 text-[11px] text-red-600 hover:bg-red-100/80 rounded-lg transition-colors"
                      >
                        <RefreshCw className="w-2.5 h-2.5" /> 重试
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    {assistantTitle && (
                      <h3 className="text-[15px] font-semibold text-gray-900 tracking-tight mb-2 pr-2">
                        {assistantTitle}
                      </h3>
                    )}

                    {(msg.isStreaming || msg.status || msg.images?.length) && (
                      <details className="mb-3">
                        <summary className="flex items-center gap-2 text-[11px] text-gray-500 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                          <span className="w-5 h-5 rounded-md bg-gray-100 flex items-center justify-center">
                            <Sparkles className="w-3 h-3 text-gray-500" />
                          </span>
                          图片分析
                          <ChevronDown className="w-3.5 h-3.5 text-gray-400 opacity-70" />
                        </summary>
                        <div className="mt-2 ml-1 pl-3 border-l-2 border-gray-100 text-[11px] text-gray-500 leading-relaxed">
                          {msg.status ||
                            (msg.isStreaming ? '正在解析需求并调用模型…' : '已根据对话与参考图完成本步生成。')}
                        </div>
                      </details>
                    )}

                    {msg.isStreaming &&
                      msg.status &&
                      ['绘制', '编辑', '生成模特', '试穿', '图案', '文生图', '生图', '生成中', '排队', '调用'].some(
                        (k) => msg.status!.includes(k),
                      ) &&
                      !msg.images?.length && (
                        <div className="mb-3 rounded-2xl overflow-hidden border border-gray-100 bg-gray-50/80">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100/80 bg-white/60">
                            <span className="text-[11px] font-medium text-gray-500 flex items-center gap-1.5">
                              <ImageIcon className="w-3.5 h-3.5" />
                              生成中
                            </span>
                            <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />
                          </div>
                          <div className="skeleton w-full" style={{ height: 200 }} />
                        </div>
                      )}

                    {msg.isStreaming && !msg.status && !msg.content && !msg.images?.length && (
                      <div className="flex items-center gap-2 py-2 text-[13px] text-gray-400">
                        <TypingDots />
                      </div>
                    )}

                    {msg.images && msg.images.length > 0 && (
                      <div className="space-y-4 w-full">
                        {msg.images.map((img, idx) => {
                          const meta = TYPE_LABEL[img.type];
                          return (
                            <div key={idx} className="scale-in relative" style={{ animationDelay: `${idx * 60}ms` }}>
                              {meta && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 mb-2 text-[10px] font-medium text-gray-500 bg-gray-100 rounded-md">
                                  {meta.icon}
                                  {meta.label}
                                </span>
                              )}
                              <div className="relative rounded-2xl overflow-hidden bg-gray-50 border border-gray-100 shadow-sm">
                                <img
                                  src={img.url}
                                  alt={meta?.label || ''}
                                  className="w-full h-auto cursor-pointer hover:opacity-[0.98] transition-opacity block"
                                  onClick={() => onPreviewImage(img.url)}
                                />
                                <div className="absolute top-1/2 right-2 -translate-y-1/2 flex flex-col gap-2">
                                  {onAddToCanvas && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onAddToCanvas(img.url);
                                      }}
                                      className="w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm border border-gray-200/80 shadow-md flex items-center justify-center text-gray-600 hover:bg-white hover:text-gray-900 transition-colors"
                                      title="置入画布"
                                    >
                                      <LayoutGrid className="w-4 h-4" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onEditImage(img.url);
                                    }}
                                    className="w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm border border-gray-200/80 shadow-md flex items-center justify-center text-gray-600 hover:bg-white hover:text-gray-900 transition-colors"
                                    title="像素编辑（全屏编辑器）"
                                  >
                                    <PencilRuler className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                <button
                                  type="button"
                                  onClick={() => onEditImage(img.url)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                                  title="打开全屏像素编辑器，可缩放裁切后下载或发回 AI"
                                >
                                  <PencilRuler className="w-3 h-3" />
                                  像素编辑
                                </button>
                                {onAddToCanvas && (
                                  <button
                                    type="button"
                                    onClick={() => onAddToCanvas(img.url)}
                                    className="px-2.5 py-1 text-[11px] font-medium bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200/80 transition-colors"
                                  >
                                    置入画布
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => dlImg(img.url)}
                                  className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
                                  title="下载"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {msg.content && (
                      <div
                        className={`text-[13px] leading-relaxed text-gray-600 mt-3 space-y-0.5 ${
                          assistantTitle ? 'pt-1 border-t border-gray-100' : ''
                        }`}
                      >
                        {msg.content.split('\n').map((l, i) => fmtLine(l, i))}
                      </div>
                    )}

                    {!msg.isStreaming && msg.content && !msg.isError && (
                      <div className="flex items-center gap-3 mt-3 pt-2 border-t border-gray-50">
                        <button
                          type="button"
                          onClick={() =>
                            setMsgFeedback((f) => {
                              const n = { ...f };
                              if (n[msg.id] === 'up') delete n[msg.id];
                              else n[msg.id] = 'up';
                              return n;
                            })
                          }
                          className={`p-1 rounded-lg transition-colors ${
                            msgFeedback[msg.id] === 'up' ? 'text-gray-900 bg-gray-100' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50'
                          }`}
                          title="有帮助"
                        >
                          <ThumbsUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMsgFeedback((f) => {
                              const n = { ...f };
                              if (n[msg.id] === 'down') delete n[msg.id];
                              else n[msg.id] = 'down';
                              return n;
                            })
                          }
                          className={`p-1 rounded-lg transition-colors ${
                            msgFeedback[msg.id] === 'down'
                              ? 'text-gray-900 bg-gray-100'
                              : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50'
                          }`}
                          title="需改进"
                        >
                          <ThumbsDown className="w-4 h-4" />
                        </button>
                        <span className="text-[10px] text-gray-300 ml-auto flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {msg.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyText(msg.content, msg.id)}
                          className="p-1 text-gray-300 hover:text-gray-500 rounded"
                          title="复制全文"
                        >
                          {copiedId === msg.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {showCtx && (
          <div className="mt-4 chat-message-enter">
            <p className="text-[10px] text-gray-400 mb-2">点击填入输入框，确认后按 Enter 发送</p>
            <div className="flex flex-wrap gap-1.5">
              {ctx.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => suggest(s)}
                  className="px-2.5 py-1.5 text-[11px] text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {(pendingFromCanvas || attachedAssets.length > 0) && (
        <div className="px-5 py-3 border-t border-gray-100 space-y-2">
          <p className="text-[10px] text-gray-400 flex items-center gap-1">
            <AtSign className="w-3 h-3 shrink-0" />
            输入 <kbd className="px-1 py-px bg-gray-100 rounded text-[9px]">@</kbd>{' '}
            可引用下图顺序（与上传后资源表「第N张」一致）
          </p>
          <div className="flex flex-wrap gap-2">
            {pendingFromCanvas && (
              <div className="relative group w-[72px]">
                <img
                  src={pendingFromCanvas}
                  alt=""
                  className="h-16 w-full object-cover rounded-lg ring-1 ring-gray-200"
                />
                <span className="absolute bottom-0.5 left-0.5 text-[9px] font-semibold text-white bg-black/55 px-1 rounded">
                  图1
                </span>
                <button
                  type="button"
                  onClick={() => onClearPendingFromCanvas?.()}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-900 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="移除画布参考"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
                <p className="text-[9px] text-gray-400 mt-0.5 truncate" title="画布">
                  画布
                </p>
              </div>
            )}
            {attachedAssets.map((a, idx) => {
              const figNum = idx + 1 + (pendingFromCanvas ? 1 : 0);
              return (
                <div key={a.localId} className="relative group w-[72px]">
                  <img src={a.preview} alt="" className="h-16 w-full object-cover rounded-lg ring-1 ring-gray-200" />
                  <span className="absolute bottom-0.5 left-0.5 text-[9px] font-semibold text-white bg-black/55 px-1 rounded">
                    图{figNum}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.localId)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-900 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="移除"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                  <p className="text-[9px] text-gray-400 mt-0.5 truncate" title={a.displayName}>
                    {a.displayName}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isLoading && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30">
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              toast('已停止', 'info');
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium text-white bg-gray-900 rounded-full shadow-lg hover:bg-gray-800 transition-colors"
          >
            <StopCircle className="w-3 h-3" /> 停止
          </button>
        </div>
      )}

      {!showWelcome && (
        <div className="shrink-0 px-4 pt-2 pb-1 border-t border-gray-100 bg-gradient-to-b from-gray-50/50 to-white">
          <div className="flex flex-wrap items-center gap-2 mb-1 min-h-[22px]">
            <span className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-3.5 h-3.5 text-white" aria-hidden />
            </span>
            <span className="text-[11px] font-semibold text-gray-800">趋势分析</span>
            <label htmlFor="trend-hot-cat-inline" className="sr-only">
              热词维度
            </label>
            <select
              id="trend-hot-cat-inline"
              value={trendHotCategory}
              onChange={(e) => setTrendHotCategory(e.target.value)}
              disabled={trendHotStatus === 'loading'}
              className="text-[10px] rounded-md border border-gray-200/90 bg-white text-gray-700 px-1.5 py-0.5 max-w-[100px] sm:max-w-[140px] focus:outline-none focus:ring-1 focus:ring-violet-300 disabled:opacity-50"
            >
              <option value="">全部</option>
              {TREND_DIM_ORDER.map((k) => (
                <option key={k} value={k}>
                  {TREND_DIM_LABELS[k]}
                </option>
              ))}
            </select>
            {trendHotStatus === 'loading' && (
              <Loader2 className="w-3 h-3 animate-spin text-gray-400 shrink-0" aria-label="加载中" />
            )}
            <button
              type="button"
              onClick={() => void loadTrendHotTags()}
              disabled={trendHotStatus === 'loading'}
              className="ml-auto flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100/80 transition-colors disabled:opacity-50"
              title="刷新热词"
            >
              <RefreshCw className={`w-3 h-3 ${trendHotStatus === 'loading' ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
          {trendHotDisplayBlocks.length > 0 ? (
            <div className="max-h-28 overflow-y-auto pb-1.5 -mx-1 px-1 scrollbar-thin [scrollbar-width:thin] space-y-2">
              {trendHotDisplayBlocks.map((block) => (
                <div key={block.key}>
                  {!trendHotCategory && (
                    <p className="text-[9px] font-medium text-gray-400 mb-1">{block.label}</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {block.items.map((it) => (
                      <button
                        key={`${it.category}-${it.keyword}`}
                        type="button"
                        onClick={() => applyTrendHotTag(it.keyword)}
                        className="shrink-0 max-w-[160px] sm:max-w-[200px] truncate px-2 py-0.5 rounded-full text-[10px] font-medium border border-gray-200/90 bg-white text-gray-700 hover:border-violet-300 hover:bg-violet-50/50 transition-colors"
                        title={
                          it.count > 0
                            ? `${it.keyword} · ${it.categoryLabel} · ${it.count}`
                            : `${it.keyword} · ${it.categoryLabel}`
                        }
                      >
                        {it.keyword}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : trendHotStatus === 'error' ? (
            <p className="text-[10px] text-gray-400 pb-1.5">热词未加载，启动趋势服务后点「刷新」</p>
          ) : trendHotStatus === 'empty' ? (
            <p className="text-[10px] text-gray-400 pb-1.5">暂无热词</p>
          ) : null}
        </div>
      )}

      <div className="p-4 border-t border-gray-100">
        <div className="relative bg-gray-50 rounded-xl focus-within:bg-white focus-within:ring-1 focus-within:ring-gray-200 transition-all">
          {mentionOpen && filteredMentions.length > 0 && (
            <div
              ref={mentionMenuRef}
              className="absolute bottom-full left-2 right-2 mb-1 max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg z-40 py-1"
            >
              {filteredMentions.map((t) => (
                <button
                  key={t.n}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMention(`图${t.n}`)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-gray-50 transition-colors"
                >
                  <span className="font-semibold text-gray-900 tabular-nums">图{t.n}</span>
                  <span className="text-gray-400 truncate flex-1 min-w-0">{t.name}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={taRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleTextareaKeyDown}
            placeholder="描述设计需求，输入 @ 引用已添加的图片（图1、图2…）"
            disabled={isLoading}
            rows={1}
            className="w-full px-3.5 pt-2.5 pb-1 bg-transparent text-[13px] resize-none focus:outline-none disabled:text-gray-400 placeholder:text-gray-400 max-h-28"
          />
          <div className="flex items-center justify-between px-1.5 pb-1.5 gap-1 flex-wrap">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={isLoading || attachedAssets.length >= MAX_ATTACHMENTS}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors disabled:opacity-40"
                title={`添加图片（最多 ${MAX_ATTACHMENTS} 张，可多选）`}
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFileSelect} />
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  const next = !trendActive;
                  setTrendActive(next);
                  onTrendToggle?.(trendId, next);
                  toast(next ? '趋势感知已开启 — AI 将参考当前趋势风格' : '趋势感知已关闭', 'info');
                }}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                  trendActive && trendId
                    ? 'text-violet-600 bg-violet-50'
                    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100/80'
                }`}
                title={
                  trendId
                    ? trendActive
                      ? '趋势感知已开启（点击关闭）'
                      : '趋势感知已关闭（点击开启）'
                    : '在趋势探索页选择趋势后可开启'
                }
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium hidden sm:inline">
                  {trendActive && trendId ? '趋势 ✦' : '趋势'}
                </span>
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  const capabilities = [
                    '🎨 文生图 — 描述即可生成服装照片/概念图',
                    '✏️ 草图绘制 — 生成黑白线稿款式图',
                    '🖌 图片编辑 — 基于现有图修改颜色/细节',
                    '🧩 图案迁移 — 将花纹应用到服装上',
                    '👤 模特生成 — 生成展示用模特',
                    '👗 虚拟试穿 — 服装+模特合成试穿效果',
                  ].join('\n');
                  toast('AI 设计助手支持以下能力，直接描述需求即可调用', 'info');
                  setInput(prev => prev || '帮我设计一件');
                  taRef.current?.focus();
                }}
                className="flex items-center gap-1 px-2 py-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100/80 rounded-lg transition-colors disabled:opacity-40"
                title="智能体能力：文生图/草图/编辑/图案迁移/模特生成/试穿"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-[11px] font-medium hidden sm:inline">智能体</span>
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={isLoading}
                onClick={() =>
                  ctx.length
                    ? suggest(ctx[0])
                    : toast('生成图片后，这里会显示追问建议', 'info')
                }
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors disabled:opacity-40"
                title="灵感 / 快捷追问"
              >
                <Lightbulb className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  setFastMode(f => {
                    const next = !f;
                    toast(next ? '快速模式已开启 — AI 将简洁回复' : '快速模式已关闭 — AI 将详细回复', 'info');
                    return next;
                  });
                }}
                className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                  fastMode ? 'text-amber-600 bg-amber-50' : 'text-gray-400 hover:text-gray-600'
                }`}
                title={fastMode ? '快速模式已开启（点击关闭）' : '快速模式（简洁回复）'}
              >
                <Zap className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={isLoading || enhancing}
                onClick={() => void enhanceInput()}
                className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                  enhancing ? 'text-blue-500 animate-pulse' : 'text-gray-400 hover:text-gray-600'
                }`}
                title="AI 增强提示词 — 自动扩展为专业英文 prompt"
              >
                <Globe className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  const prompts = [
                    '请生成这件服装的正面+背面平铺版型图，标注关键尺寸比例',
                    '请生成这件服装的360度多角度展示（正面、侧面、背面）',
                    '请将当前设计绘制为技术规格图（含缝线、口袋位置标注）',
                  ];
                  const pick = prompts[Math.floor(Math.random() * prompts.length)];
                  setInput(pick);
                  toast('已生成版型参考 prompt，可直接发送或修改', 'info');
                  taRef.current?.focus();
                }}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors disabled:opacity-40"
                title="版型参考 — 生成平铺图/多角度/技术规格图"
              >
                <Box className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={isLoading || (!input.trim() && attachedAssets.length === 0 && !pendingFromCanvas)}
                className="ml-0.5 p-2.5 bg-gray-900 text-white rounded-full hover:bg-gray-800 transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed shadow-sm"
                title="发送"
              >
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-300 mt-2 text-center">
          Enter 发送 · Shift+Enter 换行 · 支持一次选择多张图片
        </p>
      </div>
    </div>
  );
};

export default ChatPanel;
