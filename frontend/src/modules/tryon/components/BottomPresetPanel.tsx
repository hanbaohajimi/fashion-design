import type { TryOnSelection, TryOnClothing, PresetRef } from '../../../types/profile';
import type { TryOnModule } from './LeftModuleBar';
import ClothesPicker from './ClothesPicker';
import SinglePicker from './SinglePicker';
import BeautyPicker from './BeautyPicker';

interface BottomPresetPanelProps {
  authToken: string;
  module: TryOnModule;
  selection: TryOnSelection;
  onToggleClothes: (c: TryOnClothing) => void;
  onSelectModel: (p: PresetRef | null) => void;
  onSelectBackground: (p: PresetRef | null) => void;
  onSelectAction: (p: PresetRef | null) => void;
  onSelectBeauty: (kind: 'hairstyle' | 'color', p: PresetRef | null) => void;
}

const MODULE_TITLES: Record<TryOnModule, { kicker: string; em: string; hint: string }> = {
  clothes:    { kicker: 'Garment', em: 'Multi-select', hint: '穿搭 · 多选衣物' },
  model:      { kicker: 'Model', em: 'Single', hint: '模特 · 单选' },
  background: { kicker: 'Scene', em: 'Single', hint: '背景 · 单选' },
  action:     { kicker: 'Pose', em: 'Single', hint: '动作姿势 · 单选' },
  beauty:     { kicker: 'Beauty', em: 'Hair + Color', hint: '美颜 · 发型 + 颜色' },
};

export default function BottomPresetPanel({
  authToken,
  module,
  selection,
  onToggleClothes,
  onSelectModel,
  onSelectBackground,
  onSelectAction,
  onSelectBeauty,
}: BottomPresetPanelProps) {
  const t = MODULE_TITLES[module];
  return (
    <div className="tryon-bottom">
      <div className="tryon-bottom-head">
        <span className="kicker" style={{ fontSize: 10, letterSpacing: '0.22em' }}>{t.kicker}</span>
        <span className="serif" style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--color-ink-3)' }}>/ {t.em}</span>
        <span className="rule-vertical" />
        <span style={{ fontSize: 11, fontFamily: 'var(--font-ui)', color: 'var(--color-ink-2)', letterSpacing: '0.02em' }}>
          {t.hint}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        {module === 'clothes' && (
          <ClothesPicker authToken={authToken} selected={selection.clothes} onToggle={onToggleClothes} />
        )}
        {module === 'model' && (
          <SinglePicker
            authToken={authToken}
            category="models"
            selected={selection.model}
            onSelect={onSelectModel}
            genderTabs
            emptyHint="暂无模特预设，请在 services/design/presets/models/ 添加"
          />
        )}
        {module === 'background' && (
          <SinglePicker
            authToken={authToken}
            category="backgrounds"
            selected={selection.background}
            onSelect={onSelectBackground}
            emptyHint="暂无背景预设，请在 services/design/presets/backgrounds/ 添加"
          />
        )}
        {module === 'action' && (
          <SinglePicker
            authToken={authToken}
            category="actions"
            selected={selection.action}
            onSelect={onSelectAction}
            emptyHint="暂无动作预设，请在 services/design/presets/actions/ 添加"
          />
        )}
        {module === 'beauty' && (
          <BeautyPicker
            authToken={authToken}
            hairstyle={selection.beauty.hairstyle}
            color={selection.beauty.color}
            onSelect={onSelectBeauty}
          />
        )}
      </div>
    </div>
  );
}
