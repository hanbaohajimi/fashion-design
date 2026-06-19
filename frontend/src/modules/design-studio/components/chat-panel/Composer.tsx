import React, { useRef } from 'react';
import {
  AtSign,
  Box,
  Globe,
  Lightbulb,
  Loader2,
  Paperclip,
  Send,
  Sparkles,
  TrendingUp,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { MAX_ATTACHMENTS } from './utils';
import type { LocalAttachment } from './types';

interface ComposerProps {
  input: string;
  onChangeInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSend: () => void;
  isLoading: boolean;
  attachedAssets: LocalAttachment[];
  pendingFromCanvas?: string | null;
  onClearPendingFromCanvas?: () => void;
  onRemoveAttachment: (localId: string) => void;
  isDragging: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;

  mentionOpen: boolean;
  filteredMentions: { n: number; name: string }[];
  onInsertMention: (figLabel: string) => void;

  trendActive: boolean;
  trendId?: string;
  onToggleTrend: () => void;

  fastMode: boolean;
  onToggleFastMode: () => void;

  enhancing: boolean;
  onEnhanceInput: () => void;

  onSuggest: (prompt: string) => void;
  onShowTip: (msg: string, kind?: 'info' | 'success' | 'error') => void;

  onAbort: () => void;
}

export function Composer({
  input,
  onChangeInput,
  onKeyDown,
  textareaRef,
  fileInputRef,
  onFileSelect,
  onSend,
  isLoading,
  attachedAssets,
  pendingFromCanvas,
  onClearPendingFromCanvas,
  onRemoveAttachment,
  isDragging,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  mentionOpen,
  filteredMentions,
  onInsertMention,
  trendActive,
  trendId,
  onToggleTrend,
  fastMode,
  onToggleFastMode,
  enhancing,
  onEnhanceInput,
  onSuggest,
  onShowTip,
  onAbort,
}: ComposerProps) {
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  return (
    <>
      {(pendingFromCanvas || attachedAssets.length > 0) && (
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <p
            style={{
              fontSize: 10,
              color: 'var(--color-ink-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--font-ui)',
              letterSpacing: '0.04em',
            }}
          >
            <AtSign className="w-3 h-3 shrink-0" strokeWidth={1.5} />
            输入 <kbd style={{ padding: '1px 4px', background: 'var(--color-surface-3)', fontSize: 9, fontFamily: 'var(--font-ui)' }}>@</kbd>{' '}
            可引用下图顺序（与上传后资源表「第N张」一致）
          </p>
          <div className="flex flex-wrap gap-2">
            {pendingFromCanvas && (
              <div className="composer-fig">
                <img src={pendingFromCanvas} alt="" />
                <span className="composer-fig-no">Fig 1</span>
                <button
                  type="button"
                  onClick={() => onClearPendingFromCanvas?.()}
                  className="composer-fig-x"
                  title="移除画布参考"
                >
                  <X className="w-2.5 h-2.5" strokeWidth={1.5} />
                </button>
                <p className="composer-fig-name" title="画布">画布</p>
              </div>
            )}
            {attachedAssets.map((a, idx) => {
              const figNum = idx + 1 + (pendingFromCanvas ? 1 : 0);
              return (
                <div key={a.localId} className="composer-fig">
                  <img src={a.preview} alt="" />
                  <span className="composer-fig-no">Fig {figNum}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(a.localId)}
                    className="composer-fig-x"
                    title="移除"
                  >
                    <X className="w-2.5 h-2.5" strokeWidth={1.5} />
                  </button>
                  <p className="composer-fig-name" title={a.displayName}>
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
            onClick={onAbort}
            className="stop-btn"
          >
            <span style={{ width: 8, height: 8, background: 'currentColor', display: 'inline-block' }} />
            停止生成
          </button>
        </div>
      )}

      <div
        className="composer-shell"
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {isDragging && (
          <div className="composer-drop">
            <Upload className="mb-2 h-5 w-5" style={{ color: 'var(--color-ink-3)' }} strokeWidth={1.5} />
            <p style={{ fontSize: 12, color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)', letterSpacing: '0.04em' }}>松开上传图片</p>
          </div>
        )}

        <div className="composer-box">
          {mentionOpen && filteredMentions.length > 0 && (
            <div ref={mentionMenuRef} className="composer-mention">
              {filteredMentions.map(t => (
                <button
                  key={t.n}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => onInsertMention(`图${t.n}`)}
                  className="composer-mention-row"
                >
                  <span className="serif" style={{ fontSize: 13, color: 'var(--color-ink)' }}>图{t.n}</span>
                  <span style={{ minWidth: 0, flex: 1, color: 'var(--color-ink-3)', fontSize: 12, fontFamily: 'var(--font-ui)' }}>
                    {t.name}
                  </span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={onChangeInput}
            onKeyDown={onKeyDown}
            placeholder="描述设计需求，输入 @ 引用已添加的图片（图1、图2…）"
            disabled={isLoading}
            rows={1}
            className="composer-textarea"
          />
          <div className="composer-bar">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || attachedAssets.length >= MAX_ATTACHMENTS}
                className="composer-icon-btn"
                title={`添加图片（最多 ${MAX_ATTACHMENTS} 张，可多选）`}
              >
                <Paperclip className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileSelect}
              />
              <button
                type="button"
                disabled={isLoading}
                onClick={onToggleTrend}
                className="composer-text-btn"
                data-active={trendActive && !!trendId}
                title={
                  trendId
                    ? trendActive
                      ? '趋势感知已开启（点击关闭）'
                      : '趋势感知已关闭（点击开启）'
                    : '在趋势探索页选择趋势后可开启'
                }
              >
                <TrendingUp className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden sm:inline">{trendActive && trendId ? '趋势 ✦' : '趋势'}</span>
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  onShowTip('AI 设计助手支持以下能力，直接描述需求即可调用', 'info');
                  onSuggest('帮我设计一件');
                }}
                className="composer-text-btn"
                title="智能体能力：文生图/草图/编辑/图案迁移/模特生成/试穿"
              >
                <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} />
                <span className="hidden sm:inline">智能体</span>
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={isLoading}
                onClick={() => onShowTip('上方的能力按钮可一键发起任意生成，不必按顺序', 'info')}
                className="composer-icon-btn"
                title="灵感 / 快捷追问"
              >
                <Lightbulb className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={onToggleFastMode}
                className="composer-icon-btn"
                data-active={fastMode}
                title={fastMode ? '快速模式已开启（点击关闭）' : '快速模式（简洁回复）'}
              >
                <Zap className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                disabled={isLoading || enhancing}
                onClick={onEnhanceInput}
                className="composer-icon-btn"
                data-active={enhancing}
                title="AI 增强提示词 — 自动扩展为专业英文 prompt"
              >
                <Globe className={`w-3.5 h-3.5 ${enhancing ? 'animate-pulse' : ''}`} strokeWidth={1.5} />
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
                  onSuggest(pick);
                  onShowTip('已生成版型参考 prompt，可直接发送或修改', 'info');
                }}
                className="composer-icon-btn"
                title="版型参考 — 生成平铺图/多角度/技术规格图"
              >
                <Box className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={
                  isLoading ||
                  (!input.trim() && attachedAssets.length === 0 && !pendingFromCanvas)
                }
                className="composer-send"
                title="发送"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  <Send className="w-4 h-4" strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>
        </div>
        <p
          style={{
            marginTop: 8,
            textAlign: 'center',
            fontSize: 10,
            color: 'var(--color-ink-3)',
            fontFamily: 'var(--font-ui)',
            letterSpacing: '0.06em',
          }}
        >
          Enter 发送 · Shift+Enter 换行 · 支持一次选择多张图片
        </p>
      </div>
    </>
  );
}
