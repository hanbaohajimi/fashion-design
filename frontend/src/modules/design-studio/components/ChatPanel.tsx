import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useToast } from '../../../components/Toast';
import CapabilityHub, { type SessionImage as CapSessionImage } from './CapabilityHub';
import { deriveResourcesFromImages, type CapabilityId } from '../utils/capabilities';
import type {
  ChatImage,
  ChatMessage,
  ChatPanelProps,
  LocalAttachment,
  TrendHotBlock,
  TrendHotItem,
  TrendHotStatus,
} from './chat-panel/types';
import {
  MAX_ATTACHMENTS,
  TREND_DIM_LABELS,
  TREND_DIM_ORDER,
  dataUrlToFile,
  designApiFailureMessage,
  fetchTrendHotItems,
  formatApiDetail,
  isImageFile,
  streamChat,
} from './chat-panel/utils';
import { ChatHeader } from './chat-panel/ChatHeader';
import { WelcomePanel } from './chat-panel/WelcomePanel';
import { MessageItem } from './chat-panel/MessageItem';
import { TrendHotInline } from './chat-panel/TrendHotInline';
import { Composer } from './chat-panel/Composer';

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
  const ExpandIcon = isRight ? ChevronLeft : ChevronRight;

  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => externalSessionId || crypto.randomUUID());

  useEffect(() => {
    if (externalSessionId && externalSessionId !== sessionId) {
      setSessionId(externalSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSessionId]);

  useEffect(() => {
    onSessionIdChange?.(sessionId);
  }, [sessionId, onSessionIdChange]);

  const [attachedAssets, setAttachedAssets] = useState<LocalAttachment[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [msgFeedback, setMsgFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const [trendActive, setTrendActive] = useState(trendEnabledProp);
  const [enhancing, setEnhancing] = useState(false);
  const [trendHotItems, setTrendHotItems] = useState<TrendHotItem[]>([]);
  const [trendHotCategory, setTrendHotCategory] = useState('');
  const [trendHotStatus, setTrendHotStatus] = useState<TrendHotStatus>('loading');

  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragCnt = useRef(0);

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

  const trendHotDisplayBlocks: TrendHotBlock[] = useMemo(() => {
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
    const blocks: TrendHotBlock[] = [];
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

  const revokeAttachmentPreview = useCallback((a: LocalAttachment) => {
    if (a.preview.startsWith('blob:')) URL.revokeObjectURL(a.preview);
  }, []);

  const clearAttachedAssets = useCallback(() => {
    setAttachedAssets(prev => {
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
      setAttachedAssets(prev => {
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
      setAttachedAssets(prev => {
        const a = prev.find(x => x.localId === localId);
        if (a) revokeAttachmentPreview(a);
        return prev.filter(x => x.localId !== localId);
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
    .filter(m => m.role === 'assistant' && m.images?.length)
    .map(m => m.images![m.images!.length - 1].url)
    .pop();

  const addToLibrary = useCallback(() => {
    if (!lastAssistantImageUrl) {
      toast('暂无可收藏的图片', 'info');
      return;
    }
    void navigator.clipboard.writeText(
      lastAssistantImageUrl.startsWith('http')
        ? lastAssistantImageUrl
        : `${window.location.origin}${lastAssistantImageUrl}`,
    );
    toast('最新生成图链接已复制', 'success');
  }, [lastAssistantImageUrl, toast]);

  const chatSessionTitle = (() => {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
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
    if (!raw) {
      toast('请先输入内容再增强', 'info');
      return;
    }
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
    setMessages(p => [...p, uMsg, aMsg]);
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
        setMessages(p => p.filter(m => m.id !== uMsg.id && m.id !== aId));
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
      setMessages(p => p.map(m => (m.id === aId ? { ...m, status: s } : m)));
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
        setMessages(p => p.map(m => (m.id === aId ? { ...m, status: next } : m)));
      });
    };

    try {
      await streamChat(
        sessionId,
        uMsg.content,
        ev => {
          switch (ev.type) {
            case 'status': {
              const s = (ev.content || '').trim();
              if (IMG_PHASE_HINTS.some(k => s.includes(k)) && !imgLoading) imgLoading = true;
              if (s) queueStatus(s);
              break;
            }
            case 'image':
              flushPendingStatus();
              if (ev.url) {
                const url = ev.url as string;
                if (imgs.some(x => x.url === url)) break;
                const ex = ev as Record<string, unknown>;
                const t =
                  (typeof ex.image_type === 'string' && ex.image_type) ||
                  (typeof ex.capability === 'string' && ex.capability) ||
                  (typeof ex.tool === 'string' && ex.tool) ||
                  'image';
                const ni = { url, type: t };
                imgs.push(ni);
                onImageGenerated?.(ni);
                imgLoading = false;
                setMessages(p => p.map(m => (m.id === aId ? { ...m, images: [...imgs] } : m)));
              }
              break;
            case 'message':
              flushPendingStatus();
              setMessages(p =>
                p.map(m =>
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
              setMessages(p =>
                p.map(m =>
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
              setMessages(p =>
                p.map(m => (m.id === aId ? { ...m, isStreaming: false, status: undefined } : m)),
              );
              break;
          }
        },
        ctrl.signal,
        authToken,
        mode,
        designerProjectId,
        trendId,
        trendActive,
      );
    } catch (err: unknown) {
      if (statusRaf != null) {
        cancelAnimationFrame(statusRaf);
        statusRaf = null;
      }
      pendingStatus = undefined;
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages(p =>
          p.map(m =>
            m.id === aId
              ? {
                  ...m,
                  content: err.message.includes('500') ? err.message : `连接失败: ${err.message}`,
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
        setMessages(p =>
          p.map(m =>
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
    setMessages(p => {
      const l = p.length - 1;
      return l >= 1 ? p.slice(0, l - 1) : p;
    });
    setTimeout(() => send(msg), 50);
  };

  const suggest = (t: string) => {
    setInput(prev => (prev.trim() ? prev : t));
    taRef.current?.focus();
    requestAnimationFrame(() => {
      if (taRef.current) {
        const len = taRef.current.value.length;
        taRef.current.setSelectionRange(len, len);
      }
    });
  };

  const applyTrendHotTag = (word: string) => {
    setInput(
      `结合「${word}」流行趋势热点，设计一件女装方向的概念成衣效果图，造型完整清晰、中性棚拍柔光、突出该趋势风格特征`,
    );
    taRef.current?.focus();
  };

  const dlImg = (u: string) => {
    const a = document.createElement('a');
    a.href = u;
    a.download = `design-${Date.now()}.png`;
    a.click();
    toast('开始下载', 'success');
  };

  const showWelcome = messages.length === 0 && !isLoading;
  const hasActivity =
    isLoading || messages.length > 0 || !!pendingFromCanvas || attachedAssets.length > 0;

  // CapabilityHub 派生数据
  const capabilitySessionImages = useMemo<CapSessionImage[]>(() => {
    const out: CapSessionImage[] = [];
    for (const m of messages) {
      if (!m.images) continue;
      for (const img of m.images) out.push({ url: img.url, type: img.type });
    }
    return out;
  }, [messages]);

  const capabilityUploaded = useMemo(() => {
    const list: { index: number; preview: string; displayName: string }[] = [];
    let i = 1;
    if (pendingFromCanvas) list.push({ index: i++, preview: pendingFromCanvas, displayName: '画布' });
    for (const a of attachedAssets) {
      list.push({ index: i++, preview: a.preview, displayName: a.displayName });
    }
    return list;
  }, [pendingFromCanvas, attachedAssets]);

  const capabilityResources = useMemo(
    () =>
      deriveResourcesFromImages(
        capabilitySessionImages.map(i => i.type),
        attachedAssets.length > 0 || !!pendingFromCanvas,
      ),
    [capabilitySessionImages, attachedAssets, pendingFromCanvas],
  );

  const handleCapabilityPick = useCallback((_capId: CapabilityId, finalPrompt: string) => {
    setInput(cur => (cur.trim() ? cur : finalPrompt));
    taRef.current?.focus();
    requestAnimationFrame(() => {
      if (taRef.current) {
        const len = taRef.current.value.length;
        taRef.current.setSelectionRange(len, len);
      }
    });
  }, []);

  const mentionTargets = getMentionTargets();
  const filteredMentions = mentionFilter
    ? mentionTargets.filter(
        t =>
          `图${t.n}`.includes(mentionFilter) ||
          t.name.toLowerCase().includes(mentionFilter.toLowerCase()),
      )
    : mentionTargets;

  const handleFeedback = (id: string, kind: 'up' | 'down') => {
    setMsgFeedback(f => {
      const n = { ...f };
      if (n[id] === kind) delete n[id];
      else n[id] = kind;
      return n;
    });
  };

  if (collapsed) {
    return (
      <div className="chat-rail-collapsed">
        <button
          type="button"
          onClick={onToggleCollapse}
          title="展开 AI 对话（Ctrl+B）"
          className="icon-btn-editorial"
          style={{ width: 36, height: 36 }}
        >
          <ExpandIcon className="w-4 h-4" strokeWidth={1.5} />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 4, minHeight: 24 }}>
          {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--color-ink-3)' }} strokeWidth={1.5} />}
          {!isLoading && hasActivity && (
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-success)',
              }}
              title="有进行中的会话或待发送参考图"
            />
          )}
        </div>
        <span
          className="kicker"
          style={{ marginTop: 12, writingMode: 'vertical-rl', fontSize: 9, letterSpacing: '0.28em' }}
        >
          Conversation
        </span>
      </div>
    );
  }

  return (
    <div
      className={`chat-panel-shell ${isRight ? 'chat-panel-right' : 'chat-panel-left'}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ChatHeader
        messagesCount={messages.length}
        chatSessionTitle={chatSessionTitle}
        isRight={isRight}
        onAddToLibrary={addToLibrary}
        onShareConversation={shareConversation}
        onNewChat={() => void newChat()}
        onToggleCollapse={onToggleCollapse}
        settingsButton={settingsButton}
      />

      {modeBar}

      <div className="chat-scroll chat-scrollbar">
        {showWelcome && (
          <WelcomePanel
            onSuggest={suggest}
            onApplyHotTag={applyTrendHotTag}
            onCategoryChange={setTrendHotCategory}
            onReloadHot={() => void loadTrendHotTags()}
            trendHotCategory={trendHotCategory}
            trendHotStatus={trendHotStatus}
            trendHotDisplayBlocks={trendHotDisplayBlocks}
          />
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
          {messages.map(msg => (
            <MessageItem
              key={msg.id}
              msg={msg}
              authToken={authToken}
              sessionId={sessionId}
              feedback={msgFeedback[msg.id]}
              onFeedback={handleFeedback}
              onCopy={copyText}
              onPreviewImage={onPreviewImage}
              onEditImage={onEditImage}
              onAddToCanvas={onAddToCanvas}
              onRetry={retry}
              onDownload={dlImg}
              onToast={toast}
              copiedId={copiedId}
            />
          ))}
        </div>

        <div ref={endRef} />
      </div>

      {!showWelcome && (
        <TrendHotInline
          trendHotCategory={trendHotCategory}
          trendHotStatus={trendHotStatus}
          trendHotDisplayBlocks={trendHotDisplayBlocks}
          onCategoryChange={setTrendHotCategory}
          onReloadHot={() => void loadTrendHotTags()}
          onApplyHotTag={applyTrendHotTag}
        />
      )}

      {!showWelcome && (
        <div
          className="shrink-0"
          style={{ padding: '12px 16px 4px', borderTop: '1px solid var(--color-border)' }}
        >
          <CapabilityHub
            sessionImages={capabilitySessionImages}
            uploadedAssets={capabilityUploaded}
            resources={capabilityResources}
            disabled={isLoading}
            onPick={handleCapabilityPick}
            onRequestUpload={() => fileRef.current?.click()}
          />
        </div>
      )}

      <Composer
        input={input}
        onChangeInput={handleTextareaChange}
        onKeyDown={handleTextareaKeyDown}
        textareaRef={taRef}
        fileInputRef={fileRef}
        onFileSelect={onFileSelect}
        onSend={() => void send()}
        isLoading={isLoading}
        attachedAssets={attachedAssets}
        pendingFromCanvas={pendingFromCanvas}
        onClearPendingFromCanvas={onClearPendingFromCanvas}
        onRemoveAttachment={removeAttachment}
        isDragging={isDragging}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        mentionOpen={mentionOpen}
        filteredMentions={filteredMentions}
        onInsertMention={insertMention}
        trendActive={trendActive}
        trendId={trendId}
        onToggleTrend={() => {
          const next = !trendActive;
          setTrendActive(next);
          onTrendToggle?.(trendId, next);
          toast(
            next ? '趋势感知已开启 — AI 将参考当前趋势风格' : '趋势感知已关闭',
            'info',
          );
        }}
        fastMode={fastMode}
        onToggleFastMode={() => {
          setFastMode(f => {
            const next = !f;
            toast(
              next ? '快速模式已开启 — AI 将简洁回复' : '快速模式已关闭 — AI 将详细回复',
              'info',
            );
            return next;
          });
        }}
        enhancing={enhancing}
        onEnhanceInput={() => void enhanceInput()}
        onSuggest={suggest}
        onShowTip={toast}
        onAbort={() => {
          abortRef.current?.abort();
          toast('已停止', 'info');
        }}
      />
    </div>
  );
};

export default ChatPanel;
