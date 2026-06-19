import { memo } from 'react';
import { X } from 'lucide-react';
import type { TryOnSelection, TryOnClothing, PresetRef } from '../../../types/profile';

interface Chip {
  key: string;
  label: string;
  hint?: string;
  onRemove?: () => void;
  tone?: 'clothes' | 'model' | 'bg' | 'action' | 'beauty';
}

interface SelectionChipsProps {
  selection: TryOnSelection;
  defaultModelHint: boolean;
  onRemoveClothes: (clothing: TryOnClothing) => void;
  onClearModel: () => void;
  onClearBackground: () => void;
  onClearAction: () => void;
  onClearBeauty: (key: 'hairstyle' | 'color') => void;
}

const TONE_LABEL: Record<string, string> = {
  clothes: 'Garment',
  model: 'Model',
  bg: 'Scene',
  action: 'Pose',
  beauty: 'Beauty',
};

function SelectionChipsImpl({
  selection,
  defaultModelHint,
  onRemoveClothes,
  onClearModel,
  onClearBackground,
  onClearAction,
  onClearBeauty,
}: SelectionChipsProps) {
  const chips: Chip[] = [];

  selection.clothes.forEach((c, idx) => {
    const sourceHint = c.kind === 'wardrobe' ? (c as { source_label: string }).source_label : '时尚趋势';
    const usageHint = idx < 2 ? `图${idx + 1}` : '文字';
    chips.push({
      key: `cloth-${c.kind}-${c.id}`,
      label: `${c.name || '衣物'}`,
      hint: `${sourceHint} · ${usageHint}`,
      onRemove: () => onRemoveClothes(c),
      tone: 'clothes',
    });
  });

  if (selection.model) {
    chips.push({
      key: `model-${selection.model.id}`,
      label: selection.model.name,
      onRemove: onClearModel,
      tone: 'model',
    });
  } else if (defaultModelHint) {
    chips.push({ key: 'model-default', label: '默认模特', hint: '系统', tone: 'model' });
  }

  const trail = (label: string, p: PresetRef | null, onClear: () => void, tone: Chip['tone']) => {
    if (p) chips.push({ key: label + '-' + p.id, label: `${label}: ${p.name}`, onRemove: onClear, tone });
  };
  trail('背景', selection.background, onClearBackground, 'bg');
  trail('动作', selection.action, onClearAction, 'action');
  trail('发型', selection.beauty.hairstyle, () => onClearBeauty('hairstyle'), 'beauty');
  trail('发色', selection.beauty.color, () => onClearBeauty('color'), 'beauty');

  if (!chips.length) {
    return (
      <span className="dek" style={{ fontSize: 12, color: 'var(--color-ink-3)', fontStyle: 'italic' }}>
        从左侧选择穿搭 / 模特 / 背景 / 动作 / 美颜，然后点击「生成」。
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map(chip => (
        <span key={chip.key} className="tryon-chip">
          <span className="tryon-chip-tone">{TONE_LABEL[chip.tone || 'clothes']}</span>
          <span className="tryon-chip-label">{chip.label}</span>
          {chip.hint && <span className="tryon-chip-hint">{chip.hint}</span>}
          {chip.onRemove && (
            <button
              type="button"
              onClick={chip.onRemove}
              className="tryon-chip-x"
              title="移除"
            >
              <X className="h-3 w-3" strokeWidth={1.5} />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

const SelectionChips = memo(SelectionChipsImpl);
export default SelectionChips;
