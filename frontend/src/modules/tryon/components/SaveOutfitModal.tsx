import { useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface SaveOutfitModalProps {
  open: boolean;
  defaultName?: string;
  itemCount: { wardrobe: number; preset: number };
  onClose: () => void;
  onSave: (payload: { name: string; description?: string; occasion?: string; season?: string }) => Promise<void>;
}

export default function SaveOutfitModal({ open, defaultName, itemCount, onClose, onSave }: SaveOutfitModalProps) {
  const [name, setName] = useState(defaultName || '');
  const [description, setDescription] = useState('');
  const [occasion, setOccasion] = useState('');
  const [season, setSeason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmedName = name.trim();
  const submitRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !saving && trimmedName) {
        e.preventDefault();
        submitRef.current();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, saving, onClose, trimmedName]);

  if (!open) return null;

  const canSave = trimmedName.length > 0 && !saving;
  const totalItems = itemCount.wardrobe + itemCount.preset;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        name: trimmedName,
        description: description.trim() || undefined,
        occasion: occasion.trim() || undefined,
        season: season.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }
  submitRef.current = handleSave;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(26, 24, 21, 0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border-soft)' }}>
          <h3 className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
            保存穿搭方案
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 hover:bg-gray-100"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            将以本次生成的试衣图作为封面，关联 {totalItems} 件衣物（衣橱 {itemCount.wardrobe} · 系统 {itemCount.preset}）。
            {itemCount.preset > 0 && ' 系统衣物会自动入库到「我的衣橱」。'}
          </p>

          <div>
            <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              穿搭名称<span style={{ color: 'var(--color-danger)' }}> *</span>
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={60}
              placeholder="例如：周末轻松通勤"
              className="w-full rounded-md border px-3 py-2 text-[13px] focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--border-soft)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                场合（可选）
              </label>
              <input
                type="text"
                value={occasion}
                onChange={e => setOccasion(e.target.value)}
                maxLength={20}
                placeholder="如：通勤"
                className="w-full rounded-md border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border-soft)' }}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                季节（可选）
              </label>
              <input
                type="text"
                value={season}
                onChange={e => setSeason(e.target.value)}
                maxLength={20}
                placeholder="如：春夏"
                className="w-full rounded-md border px-3 py-2 text-[13px]"
                style={{ borderColor: 'var(--border-soft)' }}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              描述（可选）
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={240}
              rows={3}
              placeholder="搭配灵感或备注"
              className="w-full resize-none rounded-md border px-3 py-2 text-[13px]"
              style={{ borderColor: 'var(--border-soft)' }}
            />
          </div>

          {err && (
            <p className="text-[12px]" style={{ color: 'var(--color-danger)' }}>
              {err}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: 'var(--border-soft)' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md px-4 py-2 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--overlay-medium)', color: 'var(--text-primary)' }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-[12px] font-medium disabled:opacity-50"
            style={{ background: 'var(--color-ink)', color: 'var(--color-canvas)' }}
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
