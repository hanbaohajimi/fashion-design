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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-gray-900">
              {type === 'personal' ? '风格档案已更新' : `「${projectName}」设计规律总结`}
            </p>
            <p className="text-[12px] text-gray-400 mt-0.5">
              选择你认可的条目添加到档案
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Items */}
        <div className="px-5 py-4 space-y-2 max-h-[50vh] overflow-y-auto">
          {newItems.map((item, i) => {
            const isAccepted = accepted.has(i);
            return (
              <div
                key={i}
                onClick={() => toggle(i)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                  isAccepted
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : 'border-gray-200 bg-gray-50/60 opacity-60'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                    isAccepted ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300'
                  }`}
                >
                  {isAccepted && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-gray-800 truncate">{label(item)}</p>
                  {item.evidence && (
                    <p className="text-[11px] text-gray-400 truncate">{item.evidence}</p>
                  )}
                </div>
                <div className="shrink-0">
                  <div className="w-12 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-400"
                      style={{ width: `${Math.round(item.confidence * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 text-right mt-0.5">
                    {Math.round(item.confidence * 100)}%
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setAccepted(new Set())}
            className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            全部取消
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 text-[12px] text-gray-500 hover:bg-gray-50 rounded-lg transition-colors"
            >
              忽略
            </button>
            <button
              type="button"
              onClick={() => onConfirm(newItems.filter((_, i) => accepted.has(i)))}
              className="px-4 py-1.5 bg-gray-900 text-white text-[12px] font-medium rounded-lg hover:bg-gray-800 transition-colors"
            >
              接受 {accepted.size > 0 ? `(${accepted.size})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
