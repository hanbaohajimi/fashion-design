import { useEffect, useState } from 'react';
import {
  ChevronDown,
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  ImageIcon,
  Loader2,
  PencilRuler,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
  GitBranch,
} from 'lucide-react';
import {
  MODEL_DISPLAY,
  TYPE_LABEL,
  TypingDots,
  extractMessageTitle,
  fmtLine,
  formatMessageDateTime,
  formatMessageTime,
  getOriginalImageUrl,
  getPreviewImageUrl,
} from './utils';
import type { ChatImage, ChatMessage } from './types';
import { addToWardrobeFromDesign } from '../../../../api/profileApi';

const TASK_PHASES = [
  { id: 'request', label: '理解需求' },
  { id: 'analysis', label: '分析素材' },
  { id: 'generation', label: '生成设计' },
  { id: 'finalizing', label: '整理结果' },
] as const;

interface MessageItemProps {
  msg: ChatMessage;
  authToken?: string;
  sessionId: string;
  feedback?: 'up' | 'down';
  onFeedback: (id: string, kind: 'up' | 'down') => void;
  onCopy: (text: string, id: string) => void;
  onPreviewImage: (url: string) => void;
  onEditImage: (url: string) => void;
  onAddToCanvas?: (url: string) => void;
  onCreateVariant?: (image: ChatImage) => void;
  onRetry: (failedMessage: string) => void;
  onDownload: (url: string) => void;
  onToast: (msg: string, kind?: 'info' | 'success' | 'error') => void;
  copiedId: string | null;
}

export function MessageItem({
  msg,
  authToken,
  sessionId,
  feedback,
  onFeedback,
  onCopy,
  onPreviewImage,
  onEditImage,
  onAddToCanvas,
  onCreateVariant,
  onRetry,
  onDownload,
  onToast,
  copiedId,
}: MessageItemProps) {
  const [savingToWardrobe, setSavingToWardrobe] = useState(false);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!msg.isStreaming || !msg.startedAt) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [msg.isStreaming, msg.startedAt]);

  const elapsedSeconds = msg.durationSeconds
    ?? (msg.startedAt ? Math.max(0, Math.floor((clock - msg.startedAt) / 1000)) : 0);
  const activePhaseIndex = Math.max(
    0,
    TASK_PHASES.findIndex(phase => phase.id === (msg.taskPhase || 'request')),
  );

  const previews = msg.uploadPreviews?.length
    ? msg.uploadPreviews
    : msg.uploadPreview
      ? [msg.uploadPreview]
      : [];

  if (msg.role === 'user') {
    return (
      <div className="chat-message-enter flex gap-3 flex-row-reverse group">
        <div
          style={{
            width: 28,
            height: 28,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          <User className="w-3.5 h-3.5" style={{ color: 'var(--color-ink-3)' }} strokeWidth={1.5} />
        </div>
        <div style={{ maxWidth: 'min(92%, 420px)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <div className="user-bubble">
            {previews.length > 0 && (
              <div className="user-bubble-figs">
                {previews.map((src, i) => (
                  <div key={i} className="user-fig">
                    <img src={src} alt="" />
                    <div>
                      <p className="kicker" style={{ fontSize: 9, letterSpacing: '0.18em' }}>Fig</p>
                      <p style={{ fontFamily: 'var(--font-display)', fontSize: 13 }}>{i + 1}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="user-bubble-body">
              {msg.content && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {msg.content.split('\n').map((l, i) => fmtLine(l, i))}
                </div>
              )}
            </div>
          </div>
          {formatMessageTime(msg.timestamp) && (
            <span className="message-local-time">
              <Clock className="w-2.5 h-2.5" strokeWidth={1.5} />
              {formatMessageTime(msg.timestamp)}
            </span>
          )}
        </div>
      </div>
    );
  }

  /* assistant / system */
  const assistantTitle =
    msg.content && !msg.isError ? extractMessageTitle(msg.content) : null;

  return (
    <div className="chat-message-enter group">
      <div className="kicker-rule" style={{ fontSize: 10, letterSpacing: '0.22em', color: 'var(--color-ink-3)' }}>
        {MODEL_DISPLAY}
      </div>
      <div
        style={{
          fontSize: 11,
          color: 'var(--color-ink-3)',
          marginTop: 4,
          marginBottom: 12,
          fontFamily: 'var(--font-ui)',
          letterSpacing: '0.02em',
        }}
      >
        <Eye className="inline w-3 h-3 mr-1" strokeWidth={1.5} />
        设计助手{formatMessageDateTime(msg.timestamp) ? ` · ${formatMessageDateTime(msg.timestamp)}` : ''}
      </div>

      {msg.isError ? (
        <div
          style={{
            padding: '14px 16px',
            border: '1px solid var(--color-danger)',
            color: 'var(--color-danger)',
            background: 'transparent',
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {msg.content}
          {msg.failedMessage && (
            <button
              type="button"
              onClick={() => onRetry(msg.failedMessage!)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 10,
                padding: '4px 10px',
                fontSize: 11,
                color: 'var(--color-danger)',
                background: 'transparent',
                border: '1px solid var(--color-danger)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                letterSpacing: '0.04em',
              }}
            >
              <RefreshCw className="w-3 h-3" strokeWidth={1.5} /> 重试
            </button>
          )}
        </div>
      ) : (
        <>
          {assistantTitle && (
            <h3 className="headline headline-sm" style={{ marginBottom: 12, paddingRight: 8 }}>
              {assistantTitle}
            </h3>
          )}

          {msg.isStreaming && (
            <div className="ai-task-progress">
              <div className="ai-task-progress__header">
                <div>
                  <p className="ai-task-progress__eyebrow">AI 任务进行中</p>
                  <p className="ai-task-progress__title">{TASK_PHASES[activePhaseIndex].label}</p>
                </div>
                <span className="ai-task-progress__elapsed">
                  <Clock size={12} strokeWidth={1.5} />
                  {elapsedSeconds} 秒
                </span>
              </div>
              <div className="ai-task-progress__steps" aria-label="生成进度">
                {TASK_PHASES.map((phase, index) => (
                  <div
                    key={phase.id}
                    className={`ai-task-progress__step ${
                      index < activePhaseIndex ? 'is-done' : index === activePhaseIndex ? 'is-active' : ''
                    }`}
                  >
                    <span className="ai-task-progress__step-mark">
                      {index < activePhaseIndex ? <Check size={10} strokeWidth={2} /> : index + 1}
                    </span>
                    <span>{phase.label}</span>
                  </div>
                ))}
              </div>
              <div className="ai-task-progress__status">
                <span className="ai-task-progress__pulse" />
                <span>{msg.status || '正在解析需求并准备模型…'}</span>
              </div>
              <p className="ai-task-progress__hint">
                {elapsedSeconds >= 30
                  ? '任务仍在处理，复杂图像可能需要更长时间。'
                  : '图像任务通常需要 10–30 秒，可随时停止。'}
              </p>
            </div>
          )}

          {!msg.isStreaming && (msg.status || msg.images?.length) && (
            <details style={{ marginBottom: 12 }}>
              <summary
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                  color: 'var(--color-ink-3)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  listStyle: 'none',
                  fontFamily: 'var(--font-ui)',
                  letterSpacing: '0.04em',
                }}
                className="[&::-webkit-details-marker]:hidden"
              >
                <Sparkles className="w-3 h-3" style={{ color: 'var(--color-ink-3)' }} strokeWidth={1.5} />
                任务记录{msg.durationSeconds ? ` · ${msg.durationSeconds} 秒` : ''}
                <ChevronDown className="w-3.5 h-3.5 opacity-70" strokeWidth={1.5} />
              </summary>
              <div
                style={{
                  marginTop: 8,
                  marginLeft: 4,
                  paddingLeft: 12,
                  borderLeft: '1px solid var(--color-border-medium)',
                  fontSize: 11,
                  color: 'var(--color-ink-3)',
                  lineHeight: 1.6,
                  fontFamily: 'var(--font-ui)',
                }}
              >
                {msg.status ||
                  (msg.isStreaming ? '正在解析需求并调用模型…' : '已根据对话与参考图完成本步生成。')}
              </div>
            </details>
          )}

          {msg.isStreaming &&
            msg.status &&
            ['绘制', '编辑', '生成模特', '试穿', '图案', '文生图', '生图', '生成中', '排队', '调用'].some(
              k => msg.status!.includes(k),
            ) &&
            !msg.images?.length && (
              <div
                style={{
                  marginBottom: 12,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-surface)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 14px',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'var(--color-surface-2)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      color: 'var(--color-ink-3)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontFamily: 'var(--font-ui)',
                    }}
                  >
                    <ImageIcon className="w-3 h-3" strokeWidth={1.5} />
                    Generating
                  </span>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--color-ink-3)' }} strokeWidth={1.5} />
                </div>
                <div className="skeleton w-full" style={{ height: 220, borderRadius: 0 }} />
              </div>
            )}

          {msg.isStreaming && !msg.status && !msg.content && !msg.images?.length && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 13, color: 'var(--color-ink-3)' }}>
              <TypingDots />
            </div>
          )}

          {msg.images && msg.images.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, width: '100%' }}>
              {msg.images.map((img, idx) => {
                const meta = TYPE_LABEL[img.type];
                const originalUrl = getOriginalImageUrl(img);
                const previewUrl = getPreviewImageUrl(img);
                return (
                  <div
                    key={idx}
                    className="scale-in"
                    style={{ animationDelay: `${idx * 60}ms`, position: 'relative' }}
                  >
                    {meta && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 8px',
                          marginBottom: 8,
                          fontSize: 10,
                          letterSpacing: '0.22em',
                          textTransform: 'uppercase',
                          color: 'var(--color-ink)',
                          background: 'transparent',
                          border: '1px solid var(--color-ink)',
                          fontFamily: 'var(--font-ui)',
                        }}
                      >
                        {meta.icon}
                        {meta.label}
                      </span>
                    )}
                    <div
                      style={{
                        position: 'relative',
                        overflow: 'hidden',
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <img
                        src={previewUrl}
                        alt={meta?.label ? `${meta.label}生成结果` : 'AI 生成的服装设计图'}
                        style={{
                          width: '100%',
                          height: 'auto',
                          cursor: 'pointer',
                          display: 'block',
                          transition: 'opacity 0.2s',
                        }}
                        onClick={() => onPreviewImage(originalUrl)}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <button
                        type="button"
                        onClick={() => onEditImage(originalUrl)}
                        className="msg-action-btn dark"
                        title="打开全屏像素编辑器"
                      >
                        <PencilRuler className="w-3 h-3" strokeWidth={1.5} />
                        像素编辑
                      </button>
                      {onAddToCanvas && (
                        <button
                          type="button"
                          onClick={() => onAddToCanvas(originalUrl)}
                          className="msg-action-btn"
                        >
                          置入画布
                        </button>
                      )}
                      {onCreateVariant && (
                        <button
                          type="button"
                          onClick={() => onCreateVariant(img)}
                          className="msg-action-btn"
                          title="以此版本为父版本继续 AI 编辑"
                        >
                          <GitBranch className="w-3 h-3" strokeWidth={1.5} />
                          创建变体
                        </button>
                      )}
                      {authToken && img.type !== 'generate_model' && img.type !== 'try_on' && (
                        <button
                          type="button"
                          disabled={savingToWardrobe}
                          onClick={async () => {
                            try {
                              setSavingToWardrobe(true);
                              await addToWardrobeFromDesign(authToken, originalUrl, sessionId, undefined, img.type);
                              onToast('已收入衣橱', 'success');
                            } catch {
                              onToast('收入衣橱失败', 'error');
                            } finally {
                              setSavingToWardrobe(false);
                            }
                          }}
                          className="msg-action-btn"
                        >
                          收入衣橱
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDownload(originalUrl)}
                        className="icon-btn-editorial"
                        style={{ width: 28, height: 28, marginLeft: 'auto' }}
                        title="下载"
                      >
                        <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                      </button>
                    </div>
                    {(img.assetId || img.modelName || img.traceId) && (
                      <div className="asset-lineage-meta">
                        <span>{img.parentAssetId ? '派生版本' : '初始版本'}</span>
                        {img.modelName && <span>{img.modelName}</span>}
                        {img.assetId && <span title={img.assetId}>ID {img.assetId.slice(0, 8)}</span>}
                        {img.traceId && <span title={img.traceId}>Trace {img.traceId.slice(0, 8)}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {msg.content && (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.7,
                color: 'var(--color-ink-2)',
                marginTop: 12,
                paddingTop: assistantTitle ? 8 : 0,
                borderTop: assistantTitle ? '1px solid var(--color-border)' : 'none',
                fontFamily: 'var(--font-ui)',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {msg.content.split('\n').map((l, i) => fmtLine(l, i))}
            </div>
          )}

          {!msg.isStreaming && msg.content && !msg.isError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                marginTop: 12,
                paddingTop: 10,
                borderTop: '1px solid var(--color-border)',
              }}
            >
              <button
                type="button"
                onClick={() => onFeedback(msg.id, 'up')}
                className="thumb-btn"
                data-active={feedback === 'up'}
                title="有帮助"
              >
                <ThumbsUp className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => onFeedback(msg.id, 'down')}
                className="thumb-btn"
                data-active={feedback === 'down'}
                title="需改进"
              >
                <ThumbsDown className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--color-ink-4)',
                  marginLeft: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: 'var(--font-ui)',
                  letterSpacing: '0.06em',
                }}
              >
                <Clock className="w-2.5 h-2.5" strokeWidth={1.5} />
                {formatMessageTime(msg.timestamp)}
              </span>
              <button
                type="button"
                onClick={() => onCopy(msg.content, msg.id)}
                className="thumb-btn"
                title="复制全文"
              >
                {copiedId === msg.id ? (
                  <Check className="w-3.5 h-3.5" strokeWidth={1.5} />
                ) : (
                  <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
