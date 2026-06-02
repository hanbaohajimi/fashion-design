import { useState, useRef, useEffect, useMemo } from 'react';
import { Sparkles, Wand2, Palette, Layers, UserCircle, Shirt, X, Upload, ImageIcon } from 'lucide-react';
import {
  CAPABILITIES,
  type CapabilityDef,
  type CapabilityId,
  type SessionResources,
  getCapabilityHints,
} from '../utils/capabilities';

const ICON_MAP = { Sparkles, Wand2, Palette, Layers, UserCircle, Shirt };

export interface SessionImage {
  url: string;
  /** tool 类型，参见 services/design/server.py 各 tool 的 record_image 标签 */
  type: string;
}

export interface UploadedAsset {
  /** 用户已上传文件的 1-based 编号（与 ChatPanel 保持一致）*/
  index: number;
  preview: string;
  displayName: string;
}

interface CapabilityHubProps {
  sessionImages: SessionImage[];
  uploadedAssets: UploadedAsset[];
  resources: SessionResources;
  disabled?: boolean;
  /** 用户最终确认能力 + 资源后调用，宿主负责把 finalPrompt 填到输入框 */
  onPick: (capabilityId: CapabilityId, finalPrompt: string) => void;
  /** 引导用户上传指定类型的图（透传给宿主的 file picker）*/
  onRequestUpload?: (need: 'dress' | 'pattern') => void;
}

const NEED_LABEL: Record<'dress' | 'model' | 'pattern', string> = {
  dress: '服装图',
  model: '模特图',
  pattern: '图案图',
};

export default function CapabilityHub({
  sessionImages,
  uploadedAssets,
  resources,
  disabled = false,
  onPick,
  onRequestUpload,
}: CapabilityHubProps) {
  const [activeCap, setActiveCap] = useState<CapabilityDef | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hints = useMemo(() => getCapabilityHints(resources), [resources]);

  useEffect(() => {
    if (!activeCap) return;
    const close = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setActiveCap(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [activeCap]);

  const handleClick = (cap: CapabilityDef) => {
    if (disabled) return;
    if (cap.needs.length === 0) {
      // 不需要底图 — 直接触发，宿主把 prompt 模板塞进输入框
      onPick(cap.id, cap.promptTemplate);
      return;
    }
    setActiveCap(cap);
  };

  const handleConfirm = (cap: CapabilityDef, mode: 'auto' | 'reference') => {
    let finalPrompt = cap.promptTemplate;
    if (mode === 'reference' && cap.needs.length > 0) {
      finalPrompt = `${cap.promptTemplate}（参考资源表中的图：${cap.needs.map((n) => NEED_LABEL[n]).join(' + ')}）`;
    } else if (mode === 'auto') {
      finalPrompt = `${cap.promptTemplate}（让 AI 自动从已有资源中选择合适的图）`;
    }
    onPick(cap.id, finalPrompt);
    setActiveCap(null);
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {CAPABILITIES.map((cap) => {
          const Icon = ICON_MAP[cap.iconName];
          const hint = hints[cap.id];
          const ready = hint.ready;
          return (
            <button
              key={cap.id}
              type="button"
              disabled={disabled}
              onClick={() => handleClick(cap)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                ready
                  ? 'border-[color:var(--ink)]/15 bg-white text-[color:var(--text-primary)] hover:bg-[color:var(--paper)]'
                  : 'border-[color:var(--border-soft)] bg-[color:var(--paper)]/60 text-[color:var(--text-muted)] hover:bg-[color:var(--paper)]'
              }`}
              title={
                ready
                  ? `${cap.title} — 资源齐全，点击直接使用`
                  : `${cap.title} — 缺 ${hint.missing.map((m) => NEED_LABEL[m]).join('、')}（点击仍可发起，AI 将提示上传）`
              }
            >
              <Icon className="h-3 w-3" />
              {cap.title}
              {ready && cap.needs.length > 0 && (
                <span className="h-1 w-1 rounded-full bg-[color:var(--signal-green)]" aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      {activeCap && (
        <div
          ref={popoverRef}
          className="dropdown-enter absolute bottom-full left-0 z-40 mb-2 w-[min(360px,calc(100vw-32px))] rounded-2xl border border-[color:var(--border-soft)] bg-white p-3 shadow-[var(--shadow-lg)]"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{activeCap.title}</p>
              <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">
                需要：{activeCap.needs.map((n) => NEED_LABEL[n]).join(' + ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveCap(null)}
              className="rounded-md p-1 text-[color:var(--text-muted)] hover:bg-[color:var(--paper)] hover:text-[color:var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            {(sessionImages.length > 0 || uploadedAssets.length > 0) && (
              <div>
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[color:var(--text-muted)]">
                  使用已有图片
                </p>
                <div className="grid grid-cols-4 gap-1.5">
                  {sessionImages.slice(-8).map((img, i) => (
                    <button
                      key={`s-${i}`}
                      type="button"
                      onClick={() => handleConfirm(activeCap, 'reference')}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-[color:var(--border-soft)] hover:border-[color:var(--ink)]"
                      title={`${img.type}（点击使用）`}
                    >
                      <img src={img.url} alt="" className="h-full w-full object-cover" />
                      <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/15" />
                    </button>
                  ))}
                  {uploadedAssets.slice(0, 4).map((a) => (
                    <button
                      key={`u-${a.index}`}
                      type="button"
                      onClick={() => handleConfirm(activeCap, 'reference')}
                      className="group relative aspect-square overflow-hidden rounded-lg border border-[color:var(--border-soft)] hover:border-[color:var(--ink)]"
                      title={`${a.displayName}（点击使用）`}
                    >
                      <img src={a.preview} alt="" className="h-full w-full object-cover" />
                      <span className="absolute bottom-0 left-0 rounded-tr bg-black/55 px-1 text-[8px] font-semibold text-white">
                        图{a.index}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {onRequestUpload && activeCap.needs.includes('dress') && (
                <button
                  type="button"
                  onClick={() => {
                    onRequestUpload('dress');
                    setActiveCap(null);
                  }}
                  className="flex items-center gap-2 rounded-xl border border-[color:var(--border-soft)] px-3 py-2 text-left text-[12px] text-[color:var(--text-primary)] hover:bg-[color:var(--paper)]"
                >
                  <Upload className="h-3.5 w-3.5 text-[color:var(--text-muted)]" />
                  <span className="flex-1">上传一张新图</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleConfirm(activeCap, 'auto')}
                className="flex items-center gap-2 rounded-xl border border-[color:var(--border-soft)] px-3 py-2 text-left text-[12px] text-[color:var(--text-primary)] hover:bg-[color:var(--paper)]"
              >
                <ImageIcon className="h-3.5 w-3.5 text-[color:var(--text-muted)]" />
                <span className="flex-1">让 AI 自动选图</span>
                <span className="text-[10px] text-[color:var(--text-muted)]">从会话资源表中匹配</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
