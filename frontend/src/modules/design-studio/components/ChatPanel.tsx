import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useToast } from '../../../components/Toast';
import CapabilityHub, { type SessionImage as CapSessionImage } from './CapabilityHub';
import {
  deriveResourcesFromImages,
  type CapabilityId,
  DEFAULT_CAPABILITY_ID,
  getCapabilityById,
  buildCapabilityMessage,
  type AttachedImageInfo,
} from '../utils/capabilities';
import ResultNextActions from './chat-panel/ResultNextActions';
import CapabilityMaterialPanel, { CAPABILITY_SLOTS } from './chat-panel/CapabilityMaterialPanel';
import type {
  ChatImage,
  ChatMessage,
  ChatPanelProps,
  ChatTaskPhase,
  LocalAttachment,
  AttachmentRole,
} from './chat-panel/types';
import { autoTitleDesign } from '../../../api/designsApi';
import {
  MAX_ATTACHMENTS,
  dataUrlToFile,
  designApiFailureMessage,
  formatApiDetail,
  isImageFile,
  streamChat,
} from './chat-panel/utils';
import { ChatHeader } from './chat-panel/ChatHeader';
import { MessageItem } from './chat-panel/MessageItem';
import { Composer } from './chat-panel/Composer';

function taskPhaseFromStatus(status: string): ChatTaskPhase {
  if (/绘制|编辑|图案|生成模特|虚拟|文生图|生图|生成中|排队|调用/.test(status)) {
    return 'generation';
  }
  if (/分析|解析|识别|读取|参考图|素材|上传/.test(status)) {
    return 'analysis';
  }
  if (/整理|总结|完善|输出|收尾/.test(status)) {
    return 'finalizing';
  }
  return 'request';
}

/**
 * 带超时的 fetch，用于 sourceUrl 图片下载。
 * 超时时 abort，让调用方区分 timeout vs 网络错误。
 */
async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
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
  designId,
  initialMessages,
  collapsed = false,
  onToggleCollapse,
  side = 'left',
  authToken,
  projectId,
  trendId,
  trendEnabled: trendEnabledProp = false,
  activeBottomPanel = null,
  canvasBottomPanelHost = null,
  onBottomPanelToggle,
  onTrendToggle,
  onActiveCapabilityChange,
  settingsButton,
  firstRunPanel,
  starterPrompt,
  onStarterPromptConsumed,
  focusComposerRequest = 0,
  selectedCanvasImageUrl = null,
}) => {
  const isRight = side === 'right';
  const ExpandIcon = isRight ? ChevronLeft : ChevronRight;

  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages || []);
  const [input, setInput] = useState('');
  const [starterSuggestion, setStarterSuggestion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => externalSessionId || crypto.randomUUID());

  useEffect(() => {
    if (!starterPrompt) return;
    setStarterSuggestion(starterPrompt);
    onStarterPromptConsumed?.();
  }, [starterPrompt, onStarterPromptConsumed]);

  useEffect(() => {
    if (externalSessionId && externalSessionId !== sessionId) {
      setSessionId(externalSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalSessionId]);

  useEffect(() => {
    if (initialMessages) setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    onSessionIdChange?.(sessionId);
  }, [sessionId, onSessionIdChange]);

  const [attachedAssets, setAttachedAssets] = useState<LocalAttachment[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [msgFeedback, setMsgFeedback] = useState<Record<string, 'up' | 'down'>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  // 当前激活能力 & 最后生成结果的能力（用于 ResultNextActions）
  const [activeCapabilityId, setActiveCapabilityId] = useState<CapabilityId>(DEFAULT_CAPABILITY_ID);
  const [lastGeneratedCapabilityId, setLastGeneratedCapabilityId] = useState<CapabilityId | null>(null);
  const [lastGeneratedPrompt, setLastGeneratedPrompt] = useState<string>('');
  // 当前生成状态文字（实时显示在 Composer 当前任务旁）
  const [generatingStatus, setGeneratingStatus] = useState<string>('');
  // 最后生成的图片 URL，用于结果后自动复用（作为下一任务 dress 素材）
  const [lastGeneratedImageUrl, setLastGeneratedImageUrl] = useState<string | null>(null);
  // 当前等待上传的目标 role（由 CapabilityMaterialPanel 的 onRequestUpload 触发）
  const [pendingUploadRole, setPendingUploadRole] = useState<AttachmentRole | null>(null);
  // 防止画布图片重复添加（记录已添加的 URL）
  const addedCanvasUrlsRef = useRef<Set<string>>(new Set());
  /**
   * 任务快照：每次正常发送时保存，供 retry/regenerate 完整恢复。
   * 保存 capabilityId、原始 message、趋势开关以及附件数组快照。
   * 重试时使用快照素材，不受用户之后切换能力或更换附件的影响。
   */
  const lastTaskSnapshotRef = useRef<{
    capabilityId: CapabilityId;
    message: string;
    trendId?: string;
    trendEnabled: boolean;
    attachments: LocalAttachment[];  // 浅拷贝；File 引用不可变，保留即可
  } | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragCnt = useRef(0);

  useEffect(() => {
    if (!focusComposerRequest || collapsed) return;
    requestAnimationFrame(() => taRef.current?.focus());
  }, [focusComposerRequest, collapsed]);

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
    (files: FileList | File[], role?: AttachmentRole) => {
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
          if (role) {
            const existing = next.findIndex(a => a.role === role);
            const newAsset: LocalAttachment = {
              localId: crypto.randomUUID(),
              file: f,
              preview: URL.createObjectURL(f),
              displayName: f.name,
              role,
              source: 'upload',
            };
            if (existing >= 0) {
              const old = next[existing];
              if (old.preview.startsWith('blob:')) URL.revokeObjectURL(old.preview);
              next.splice(existing, 1, newAsset);
            } else {
              next.push(newAsset);
            }
          } else {
            next.push({
              localId: crypto.randomUUID(),
              file: f,
              preview: URL.createObjectURL(f),
              displayName: f.name,
              source: 'upload',
            });
          }
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
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
    if (fs?.length) {
      // 如果由 CapabilityMaterialPanel 触发（有 pendingUploadRole），则带 role 上传
      attachMany(fs, pendingUploadRole ?? undefined);
    }
    e.target.value = '';
    setPendingUploadRole(null);
  };

  /** CapabilityMaterialPanel 触发的上传：记录目标 role，再打开文件选择器 */
  const handleMaterialUpload = useCallback((role: AttachmentRole) => {
    setPendingUploadRole(role);
    fileRef.current?.click();
  }, []);

  /** CapabilityMaterialPanel 触发的"从画布选择"：带 role 添加画布图片（保存 sourceUrl，发送时再下载）*/
  const handleAddCanvasAsset = useCallback(async (role: AttachmentRole) => {
    if (!selectedCanvasImageUrl) return;
    // 防止重复添加同一 URL
    if (addedCanvasUrlsRef.current.has(selectedCanvasImageUrl)) {
      toast('该画布图片已添加', 'info');
      return;
    }
    const ROLE_ZH: Record<string, string> = { dress: '服装图', model: '人物图', pattern: '图案图', reference: '参考图' };
    // 直接存 sourceUrl，不在此处下载，避免 CORS 问题或 dataUrl 过长
    // 发送时 send() 会判断 file.size === 0 或 file 缺失，改为从 sourceUrl 下载
    setAttachedAssets(prev => {
      const existing = prev.findIndex(a => a.role === role);
      const newAsset: LocalAttachment = {
        localId: crypto.randomUUID(),
        sourceUrl: selectedCanvasImageUrl,
        preview: selectedCanvasImageUrl,
        displayName: '画布图片',
        role,
        source: 'canvas',
      };
      if (existing >= 0) {
        const old = prev[existing];
        if (old.preview.startsWith('blob:')) URL.revokeObjectURL(old.preview);
        const next = [...prev];
        next.splice(existing, 1, newAsset);
        return next;
      }
      return [...prev, newAsset];
    });
    addedCanvasUrlsRef.current.add(selectedCanvasImageUrl);
    toast(`已将画布图片添加为${ROLE_ZH[role] ?? role}素材`, 'success');
  }, [selectedCanvasImageUrl, toast]);

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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
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

  const send = async (
    direct?: string,
    directCapabilityId?: CapabilityId,
    snapshotAttachments?: LocalAttachment[],
    snapshotTrend?: { trendId?: string; enabled: boolean },
  ) => {
    const rawTxt = direct || input.trim();
    const hasCanvas = !!pendingFromCanvas;
    // 重试时使用快照附件；正常发送使用当前 UI 附件
    const activeAssets = snapshotAttachments ?? attachedAssets;
    const hasFiles = activeAssets.length > 0;
    if ((!rawTxt && !hasFiles && !hasCanvas) || isLoading) return;

    // 本次发送使用的能力（direct 调用时从快照恢复，否则用当前激活能力）
    const sendCapId = directCapabilityId ?? activeCapabilityId;
    const sendTrendId = snapshotTrend?.trendId ?? trendId;
    const sendTrendEnabled = snapshotTrend?.enabled ?? trendEnabledProp;

    // 清除上次结果操作面板
    setLastGeneratedCapabilityId(null);
    setLastGeneratedPrompt(rawTxt);

    // 保存任务快照（非 direct 时，即正常发送；direct 时保留上次快照以支持多次重试）
    if (!direct) {
      lastTaskSnapshotRef.current = {
        capabilityId: sendCapId,
        message: rawTxt,
        trendId: sendTrendId,
        trendEnabled: sendTrendEnabled,
        // 浅拷贝：File 引用不可变，对象引用安全；防止后续 UI 变化影响快照
        attachments: activeAssets.map(a => ({ ...a })),
      };
    }

    // Capture before send — used to decide whether to auto-title after first exchange
    const isFirstExchange = !messages.some(m => m.role === 'assistant');

    // ── 构造带能力前缀的稳定指令消息 ────────────────────────────────────────
    const imageInfos: AttachedImageInfo[] = [];
    let idx = 1;
    if (hasCanvas) {
      imageInfos.push({ index: idx++, role: 'dress', isCanvasRef: true, displayName: '画布图片' });
    }
    for (const a of activeAssets) {
      imageInfos.push({ index: idx++, role: a.role, displayName: a.displayName });
    }
    // direct 调用不追加前缀，避免双重前缀
    const finalMessage = direct
      ? rawTxt
      : buildCapabilityMessage(sendCapId, rawTxt, imageInfos);

    const txt = finalMessage;

    // ── 按能力强制排序附件 ────────────────────────────────────────────────
    let orderedAssets = [...activeAssets];
    if (sendCapId === 'transfer_pattern') {
      const dress = activeAssets.filter(a => a.role === 'dress');
      const pattern = activeAssets.filter(a => a.role === 'pattern');
      const others = activeAssets.filter(a => a.role !== 'dress' && a.role !== 'pattern');
      orderedAssets = [...dress, ...pattern, ...others];
    } else if (sendCapId === 'try_on') {
      const model = activeAssets.filter(a => a.role === 'model');
      const dress = activeAssets.filter(a => a.role === 'dress');
      const others = activeAssets.filter(a => a.role !== 'model' && a.role !== 'dress');
      orderedAssets = [...model, ...dress, ...others];
    }

    // ── 准备上传文件 ───────────────────────────────────────────────────────
    // 只上传有真实内容的文件；sourceUrl 来源的附件先 fetchWithTimeout 下载
    const filesToUpload: File[] = [];
    if (hasCanvas) {
      try {
        filesToUpload.push(await dataUrlToFile(pendingFromCanvas!, 'canvas-reference.png'));
      } catch {
        toast('画布图片处理失败，请重试', 'error');
        return;
      }
    }
    for (const a of orderedAssets) {
      if (a.file && a.file.size > 0) {
        filesToUpload.push(a.file);
      } else if (a.sourceUrl) {
        const roleLabels: Record<string, string> = { dress: '服装图', pattern: '图案图', model: '人物图', reference: '参考图' };
        const label = a.role ? (roleLabels[a.role] ?? a.role) : a.displayName;
        try {
          const resp = await fetchWithTimeout(a.sourceUrl, 8000);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const ext = blob.type.includes('png') ? 'png' : 'jpg';
          filesToUpload.push(new File([blob], `${a.displayName || 'image'}.${ext}`, { type: blob.type || 'image/png' }));
        } catch (err) {
          const isTimeout = err instanceof DOMException && err.name === 'AbortError';
          toast(
            isTimeout
              ? `${label}图片加载超时，请重新选择图片`
              : `${label}图片加载失败，请检查图片是否仍可访问`,
            'error',
          );
          // 失败后确保 loading 恢复、prompt 不清空、素材不清空
          setIsLoading(false);
          abortRef.current = null;
          return;
        }
      }
      // file 为空且无 sourceUrl → 只在消息中说明角色，不上传文件
    }

    const uploadPreviews: string[] = [];
    if (pendingFromCanvas) uploadPreviews.push(pendingFromCanvas);
    for (const a of orderedAssets) uploadPreviews.push(a.preview);

    const uMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      // 用户可见的消息展示原始输入，不展示系统级能力前缀
      content: rawTxt || '(上传图片)',
      timestamp: new Date(),
      ...(uploadPreviews.length > 1
        ? { uploadPreviews }
        : uploadPreviews.length === 1
          ? { uploadPreview: uploadPreviews[0] }
          : {}),
    };
    const aId = crypto.randomUUID();
    const taskStartedAt = Date.now();
    const aMsg: ChatMessage = {
      id: aId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
      status: '连接中...',
      taskPhase: 'request',
      startedAt: taskStartedAt,
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
        const res = await fetch('/api/design/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
          body: fd,
        });
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

    // 记录当前能力用于结果面板（使用 sendCapId，不受后续能力切换影响）
    const sendingCapabilityId = sendCapId;

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
      setMessages(p => p.map(m => (
        m.id === aId ? { ...m, status: s, taskPhase: taskPhaseFromStatus(s) } : m
      )));
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
        setMessages(p => p.map(m => (
          m.id === aId ? { ...m, status: next, taskPhase: taskPhaseFromStatus(next) } : m
        )));
      });
    };

    try {
      await streamChat(
        sessionId,
        txt,
        ev => {
          switch (ev.type) {
            case 'status': {
              const s = (ev.content || '').trim();
              if (IMG_PHASE_HINTS.some(k => s.includes(k)) && !imgLoading) imgLoading = true;
              if (s) {
                queueStatus(s);
                setGeneratingStatus(s);
              }
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
                const ni: ChatImage = {
                  url,
                  type: t,
                  ...(typeof ex.original_url === 'string' ? { originalUrl: ex.original_url } : {}),
                  ...(typeof ex.preview_url === 'string' ? { previewUrl: ex.preview_url } : {}),
                  ...(typeof ex.thumbnail_url === 'string' ? { thumbnailUrl: ex.thumbnail_url } : {}),
                  ...(typeof ex.original_width === 'number' ? { originalWidth: ex.original_width } : {}),
                  ...(typeof ex.original_height === 'number' ? { originalHeight: ex.original_height } : {}),
                };
                imgs.push(ni);
                onImageGenerated?.(ni);
                imgLoading = false;
                // 记录最后生成的图片 URL，用于结果后自动复用
                setLastGeneratedImageUrl(url);
                setMessages(p => p.map(m => (
                  m.id === aId ? { ...m, images: [...imgs], taskPhase: 'finalizing' } : m
                )));
                // 记录这次生成的能力，用于结果后操作面板
                setLastGeneratedCapabilityId(sendingCapabilityId);
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
                        taskPhase: undefined,
                        timestamp: new Date(),
                        durationSeconds: Math.max(1, Math.round((Date.now() - taskStartedAt) / 1000)),
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
                        taskPhase: undefined,
                        timestamp: new Date(),
                        durationSeconds: Math.max(1, Math.round((Date.now() - taskStartedAt) / 1000)),
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
                p.map(m => (m.id === aId ? {
                  ...m,
                  isStreaming: false,
                  status: undefined,
                  taskPhase: undefined,
                  timestamp: new Date(),
                  durationSeconds: Math.max(1, Math.round((Date.now() - taskStartedAt) / 1000)),
                } : m)),
              );
              break;
          }
        },
        ctrl.signal,
        authToken,
        projectId,
        sendTrendId,
        sendTrendEnabled,
        designId,
        // 传递 capability_id：使用 sendCapId（含快照恢复值），而非当前 activeCapabilityId
        sendCapId,
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
                  taskPhase: undefined,
                  timestamp: new Date(),
                  durationSeconds: Math.max(1, Math.round((Date.now() - taskStartedAt) / 1000)),
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
              ? {
                  ...m,
                  content: '已取消生成',
                  isStreaming: false,
                  status: undefined,
                  taskPhase: undefined,
                  timestamp: new Date(),
                  durationSeconds: Math.max(1, Math.round((Date.now() - taskStartedAt) / 1000)),
                }
              : m,
          ),
        );
      }
    }
    setIsLoading(false);
    setGeneratingStatus('');
    abortRef.current = null;
    taRef.current?.focus();

    // After the first exchange completes, trigger AI auto-title (fire-and-forget)
    if (isFirstExchange && designId && authToken) {
      void autoTitleDesign(authToken, designId).then(title => {
        if (title) {
          window.dispatchEvent(new CustomEvent('af:design-titled', { detail: { designId, title } }));
        }
      });
    }
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
    // 从快照完整恢复：capability_id 和 attachments，不读取当前 UI 状态
    const snap = lastTaskSnapshotRef.current;
    const snapshotCapId = snap?.capabilityId;
    const snapshotAttachments = snap?.attachments;
    setMessages(p => {
      const l = p.length - 1;
      return l >= 1 ? p.slice(0, l - 1) : p;
    });
    setTimeout(() => send(
      msg,
      snapshotCapId,
      snapshotAttachments,
      snap ? { trendId: snap.trendId, enabled: snap.trendEnabled } : undefined,
    ), 50);
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

  // 当前激活能力的完整定义
  const activeCapabilityDef = getCapabilityById(activeCapabilityId);

  useEffect(() => {
    onActiveCapabilityChange?.(
      activeCapabilityId,
      activeCapabilityDef?.displayTitle ?? '生成成衣效果图',
    );
  }, [activeCapabilityId, activeCapabilityDef?.displayTitle, onActiveCapabilityChange]);

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
        // 已上传附件、画布参考、或画布选中图片均算作可用资源
        attachedAssets.length > 0 || !!pendingFromCanvas || !!selectedCanvasImageUrl,
      ),
    [capabilitySessionImages, attachedAssets, pendingFromCanvas, selectedCanvasImageUrl],
  );

  const handleCapabilityPick = useCallback((capId: CapabilityId, finalPrompt: string) => {
    setActiveCapabilityId(capId);
    setStarterSuggestion(null);
    setInput(cur => (cur.trim() ? cur : finalPrompt));
    taRef.current?.focus();
    requestAnimationFrame(() => {
      if (taRef.current) {
        const len = taRef.current.value.length;
        taRef.current.setSelectionRange(len, len);
      }
    });
  }, []);

  /** P0-3: 将画布选中图片作为当前素材添加（方案A：不自动发送）*/
  const handleUseCanvasImage = useCallback(async () => {
    if (!selectedCanvasImageUrl) return;
    const existingDress = attachedAssets.some(a => a.role === 'dress');
    const defaultRole: 'dress' | 'model' =
      activeCapabilityId === 'try_on' && existingDress ? 'model' : 'dress';
    void handleAddCanvasAsset(defaultRole);
  }, [selectedCanvasImageUrl, activeCapabilityId, attachedAssets, handleAddCanvasAsset]);

  /** 结果后操作：切换到指定能力，自动将最后生成图作为 dress 素材（sourceUrl，不创建空File）*/
  const handleNextCapability = useCallback((capId: CapabilityId) => {
    setActiveCapabilityId(capId);
    setStarterSuggestion(null);
    const needsDress = CAPABILITY_SLOTS[capId]?.includes('dress') ?? false;
    if (needsDress && lastGeneratedImageUrl) {
      setAttachedAssets(prev => {
        const hasDress = prev.some(a => a.role === 'dress');
        if (hasDress) {
          return prev.map(a =>
            a.role === 'dress'
              ? {
                  ...a,
                  preview: lastGeneratedImageUrl,
                  sourceUrl: lastGeneratedImageUrl,
                  displayName: '生成结果',
                  role: 'dress' as AttachmentRole,
                  source: 'generated' as const,
                }
              : a,
          );
        }
        // 使用 sourceUrl，不创建 0 字节 File placeholder
        return [
          ...prev,
          {
            localId: crypto.randomUUID(),
            sourceUrl: lastGeneratedImageUrl,
            preview: lastGeneratedImageUrl,
            displayName: '生成结果',
            role: 'dress' as AttachmentRole,
            source: 'generated' as const,
          },
        ];
      });
      toast('已将生成结果设为服装图素材', 'success');
    }
    taRef.current?.focus();
    setLastGeneratedCapabilityId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastGeneratedImageUrl, toast]);

  /** 重新生成：从快照完整恢复 capability_id + attachments，不读取当前 UI 状态 */
  const handleRegenerate = useCallback(() => {
    if (lastGeneratedPrompt) {
      const snap = lastTaskSnapshotRef.current;
      void send(
        lastGeneratedPrompt,
        snap?.capabilityId,
        snap?.attachments,
        snap ? { trendId: snap.trendId, enabled: snap.trendEnabled } : undefined,
      );
    }
    setLastGeneratedCapabilityId(null);
  }, [lastGeneratedPrompt]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const designTaskPortal = canvasBottomPanelHost && activeBottomPanel === 'design-task'
    ? createPortal(
        <section className="canvas-bottom-panel-body design-task-panel" aria-label="设计任务选择">
          <CapabilityHub
            sessionImages={capabilitySessionImages}
            uploadedAssets={capabilityUploaded}
            resources={capabilityResources}
            disabled={isLoading}
            activeCapabilityId={activeCapabilityId}
            onCapabilityChange={(capId) => {
              setActiveCapabilityId(capId);
              setStarterSuggestion(null);
              setLastGeneratedCapabilityId(null);
            }}
            onPick={handleCapabilityPick}
            onRequestUpload={handleMaterialUpload}
          />
        </section>,
        canvasBottomPanelHost,
      )
    : null;

  if (collapsed) {
    return (
      <>
        {designTaskPortal}
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
      </>
    );
  }

  return (
    <>
      {designTaskPortal}
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
      <div className="chat-scroll chat-scrollbar">
        {showWelcome && firstRunPanel}
        {showWelcome && (
          <div className="chat-welcome-block">
            <h2 className="headline headline-md">你好，设计师</h2>
            <p
              style={{
                marginTop: 12,
                fontFamily: 'var(--font-ui)',
                fontSize: 13,
                lineHeight: 1.7,
                color: 'var(--color-ink-3)',
                maxWidth: 280,
              }}
            >
              描述你的设计想法，AI 将生成方案。
              <br />
              完成后可将结果置入左侧画布继续编辑。
            </p>
            <div className="chat-welcome-steps">
              <span>描述设计</span>
              <span style={{ opacity: 0.45 }}>·</span>
              <span>生成方案</span>
              <span style={{ opacity: 0.45 }}>·</span>
              <span>置入画布</span>
            </div>
          </div>
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

      {/* ── Composer Dock：画布选图 + 结果操作 + 素材面板 + 输入框归组为底部输入坞 ── */}
      <div className="assistant-composer-dock">

      {/* 画布选中图片提示；任务选择器已移入画布底部 Portal */}
      {selectedCanvasImageUrl && (
        <div
          className="shrink-0"
          style={{ padding: '12px 16px 4px', borderTop: '1px solid var(--color-border)' }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
              padding: '5px 8px',
              background: 'var(--color-paper)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: 10,
              fontFamily: 'var(--font-ui)',
              color: 'var(--color-ink-2)',
            }}
          >
            <img
              src={selectedCanvasImageUrl}
              alt=""
              style={{ width: 22, height: 22, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }}
            />
            <span style={{ flex: 1 }}>
              已选择画布图片
            </span>
            {/* 为有素材槽的能力直接提供明确角色按钮；其他情况默认添加为 dress */}
            {activeCapabilityId === 'try_on' ? (
              <>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleAddCanvasAsset('model')}
                  style={{ padding: '2px 7px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', fontSize: 10, fontFamily: 'var(--font-ui)', color: 'var(--color-ink-2)', cursor: isLoading ? 'not-allowed' : 'pointer' }}
                >
                  作为人物图
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleAddCanvasAsset('dress')}
                  style={{ padding: '2px 7px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', fontSize: 10, fontFamily: 'var(--font-ui)', color: 'var(--color-ink-2)', cursor: isLoading ? 'not-allowed' : 'pointer' }}
                >
                  作为服装图
                </button>
              </>
            ) : activeCapabilityId === 'transfer_pattern' ? (
              <>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleAddCanvasAsset('dress')}
                  style={{ padding: '2px 7px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', fontSize: 10, fontFamily: 'var(--font-ui)', color: 'var(--color-ink-2)', cursor: isLoading ? 'not-allowed' : 'pointer' }}
                >
                  作为服装图
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => void handleAddCanvasAsset('pattern')}
                  style={{ padding: '2px 7px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', fontSize: 10, fontFamily: 'var(--font-ui)', color: 'var(--color-ink-2)', cursor: isLoading ? 'not-allowed' : 'pointer' }}
                >
                  作为图案图
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={isLoading}
                onClick={() => void handleAddCanvasAsset('dress')}
                style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'white', fontSize: 10, fontFamily: 'var(--font-ui)', color: 'var(--color-ink)', cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.4 : 1 }}
                title="将画布图片添加为服装图素材"
              >
                添加为素材
              </button>
            )}
          </div>
        </div>
      )}

      {/* 生成结果后的下一步操作面板 */}
      {lastGeneratedCapabilityId && !isLoading && (
        <ResultNextActions
          completedCapabilityId={lastGeneratedCapabilityId}
          hasDressImage={capabilityResources.hasDress}
          onSelectNextCapability={handleNextCapability}
          onContinueEditing={() => handleNextCapability('edit_image')}
          onRegenerate={handleRegenerate}
        />
      )}

      {/* 素材角色插槽（edit_image / transfer_pattern / try_on 专用）*/}
      <CapabilityMaterialPanel
        activeCapabilityId={activeCapabilityId}
        attachedAssets={attachedAssets}
        disabled={isLoading}
        selectedCanvasImageUrl={selectedCanvasImageUrl}
        onRequestUpload={handleMaterialUpload}
        onRemoveAttachment={removeAttachment}
        onAddCanvasAsset={handleAddCanvasAsset}
      />

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
        trendActive={trendEnabledProp}
        trendPanelActive={activeBottomPanel === 'trend-pulse'}
        onToggleTrend={() => onTrendToggle?.(trendId)}
        designTaskActive={activeBottomPanel === 'design-task'}
        onToggleDesignTask={() => onBottomPanelToggle?.('design-task')}
        enhancing={enhancing}
        onEnhanceInput={() => void enhanceInput()}
        onSuggest={suggest}
        onShowTip={toast}
        onAbort={() => {
          abortRef.current?.abort();
          toast('已停止', 'info');
        }}
        activeCapability={activeCapabilityDef}
        examplePrompt={starterSuggestion ?? activeCapabilityDef?.examplePrompt}
        onUseExamplePrompt={(prompt) => {
          suggest(prompt);
          setStarterSuggestion(null);
        }}
        generatingStatus={isLoading ? generatingStatus : undefined}
      />

      </div>{/* end .assistant-composer-dock */}
      </div>
    </>
  );
};

export default ChatPanel;
