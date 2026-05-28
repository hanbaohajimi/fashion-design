import { useState } from 'react';
import { Check, X, Sparkles } from 'lucide-react';

interface DiffItem {
  tag?: string;
  pattern?: string;
  confidence: number;
  evidence?: string;
}

interface ProfileDiffModalProps {
  type: 'personal' | 'designer';
  projectName?: string;
  newItems: DiffItem[];
  onConfirm: (accepted: DiffItem[]) => void;
  onDismiss: () => void;
}

export default function ProfileDiffModal({
  type,
  projectName,
  newItems,
  onConfirm,
  onDismiss,
}: ProfileDiffModalProps) {
  const [accepted, setAccepted] = useState<Set<number>>(
    new Set(newItems.map((_, i) => i)),
  );

  const toggle = (i: number) =>
    setAccepted(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const label = (item: DiffItem) => item.tag || item.pattern || '';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 backdrop-blur-sm sm:items-center sm:pb-0">
      <div className="dialog-panel w-full max-w-md overflow-hidden">
        <div className="flex items-start gap-3 border-b border-[color:var(--border-soft)] px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-50">
            <Sparkles className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[color:var(--text-primary)]">
              {type === 'personal' ? '风格档案已更新' : `「${projectName}」设计规律总结`}
            </p>
            <p className="mt-0.5 text-[12px] text-[color:var(--text-secondary)]">
              选择你认可的条目添加到档案
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="btn-ghost btn-square h-9 min-h-9 w-9"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto px-5 py-4">
          {newItems.map((item, i) => {
            const isAccepted = accepted.has(i);
            return (
              <div
                key={i}
                onClick={() => toggle(i)}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${
                  isAccepted
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-[color:var(--border-soft)] bg-[color:var(--paper)] opacity-70'
                }`}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                    isAccepted ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'
                  }`}
                >
                  {isAccepted && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[13px] font-medium text-[color:var(--text-primary)]">{label(item)}</p>
                  {item.evidence && (
                    <p className="truncate text-[11px] text-[color:var(--text-muted)]">{item.evidence}</p>
                  )}
                </div>
                <div className="shrink-0">
                  <div className="h-1.5 w-12 overflow-hidden rounded-full bg-[color:var(--paper)]">
                    <div
                      className="h-full rounded-full bg-[color:var(--signal-green)]"
                      style={{ width: `${Math.round(item.confidence * 100)}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-right text-[10px] text-[color:var(--text-muted)]">
                    {Math.round(item.confidence * 100)}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-[color:var(--border-soft)] px-5 py-4 bg-[color:var(--paper)]">
          <button
            type="button"
            onClick={() => setAccepted(new Set())}
            className="text-[12px] text-[color:var(--text-muted)] transition-colors hover:text-[color:var(--text-primary)]"
          >
            全部取消
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="btn-secondary px-3 text-[12px]"
            >
              忽略
            </button>
            <button
              type="button"
              onClick={() => onConfirm(newItems.filter((_, i) => accepted.has(i)))}
              className="btn-primary px-4 text-[12px] font-semibold"
            >
              接受 {accepted.size > 0 ? `(${accepted.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
