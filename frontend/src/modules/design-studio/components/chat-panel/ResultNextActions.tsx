import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { CapabilityId } from '../../utils/capabilities';

interface NextAction {
  label: string;
  capabilityId: CapabilityId;
  description?: string;
  isPrimary?: boolean;
}

interface ResultNextActionsProps {
  /** 完成的能力 */
  completedCapabilityId: CapabilityId;
  /** 已有服装图（用于判断能否展示后续能力）*/
  hasDressImage: boolean;
  onSelectNextCapability: (capabilityId: CapabilityId) => void;
  onContinueEditing: () => void;
  onRegenerate: () => void;
}

/** 根据完成的能力推荐下一步操作 */
function getNextActions(completedId: CapabilityId, hasDressImage: boolean): NextAction[] {
  switch (completedId) {
    case 'text_to_image':
      return [
        { label: '继续修改', capabilityId: 'edit_image', description: '修改颜色、面料或版型', isPrimary: true },
        { label: '生成模特展示', capabilityId: 'generate_model', description: '将设计展示在模特身上', isPrimary: true },
        { label: '虚拟试穿', capabilityId: 'try_on', description: '穿到指定人物身上' },
        { label: '应用图案', capabilityId: 'transfer_pattern', description: '添加花纹或 Logo' },
      ];
    case 'draw_sketch':
      return [
        { label: '生成效果图', capabilityId: 'text_to_image', description: '从草图生成成衣照片', isPrimary: true },
        { label: '继续修改草图', capabilityId: 'edit_image', description: '调整草图细节' },
      ];
    case 'edit_image':
      return [
        { label: '生成模特展示', capabilityId: 'generate_model', description: '展示修改后的设计', isPrimary: true },
        { label: '虚拟试穿', capabilityId: 'try_on', description: '穿到指定人物身上' },
        { label: '继续修改', capabilityId: 'edit_image', description: '再次编辑' },
        { label: '应用图案', capabilityId: 'transfer_pattern', description: '添加花纹或 Logo' },
      ];
    case 'transfer_pattern':
      return [
        { label: '生成模特展示', capabilityId: 'generate_model', description: '展示图案效果', isPrimary: true },
        { label: '继续修改', capabilityId: 'edit_image', description: '进一步调整' },
      ];
    case 'generate_model':
      return [
        { label: '虚拟试穿', capabilityId: 'try_on', description: '换到其他人物身上', isPrimary: true },
        { label: '生成同系列', capabilityId: 'text_to_image', description: '生成同系列其他单品' },
        { label: '继续修改设计', capabilityId: 'edit_image', description: '调整服装细节' },
      ];
    case 'try_on':
      return [
        { label: '生成同系列', capabilityId: 'text_to_image', description: '设计同系列单品', isPrimary: true },
        { label: '换模特展示', capabilityId: 'generate_model', description: '在不同模特上展示' },
      ];
    default:
      return [];
  }
}

const CAPABILITY_DISPLAY: Record<CapabilityId, string> = {
  text_to_image: '生成成衣效果图',
  draw_sketch: '生成设计草图',
  edit_image: '编辑已有图片',
  transfer_pattern: '将图案应用到服装',
  generate_model: '生成模特展示图',
  try_on: '虚拟试穿',
};

export default function ResultNextActions({
  completedCapabilityId,
  hasDressImage,
  onSelectNextCapability,
  onContinueEditing,
  onRegenerate,
}: ResultNextActionsProps) {
  const actions = getNextActions(completedCapabilityId, hasDressImage);
  const primaryActions = actions.filter(a => a.isPrimary);
  const secondaryActions = actions.filter(a => !a.isPrimary);

  const completedLabel = CAPABILITY_DISPLAY[completedCapabilityId] || completedCapabilityId;

  return (
    <div
      style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-paper)',
      }}
    >
      <p
        style={{
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--color-ink-4)',
          fontFamily: 'var(--font-ui)',
          marginBottom: 8,
        }}
      >
        已完成{completedLabel} — 推荐下一步
      </p>

      {primaryActions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: secondaryActions.length > 0 ? 8 : 0 }}>
          {primaryActions.map(action => (
            <button
              key={action.capabilityId + action.label}
              type="button"
              onClick={() => onSelectNextCapability(action.capabilityId)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 10px',
                borderRadius: 7,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'border-color 0.1s, background 0.1s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-ink)';
                (e.currentTarget as HTMLButtonElement).style.background = 'white';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-surface)';
              }}
            >
              <span style={{ flex: 1 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontFamily: 'var(--font-ui)',
                    fontWeight: 500,
                    color: 'var(--color-ink)',
                    letterSpacing: '-0.005em',
                  }}
                >
                  {action.label}
                </span>
                {action.description && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: 10,
                      fontFamily: 'var(--font-ui)',
                      color: 'var(--color-ink-3)',
                      marginTop: 1,
                    }}
                  >
                    {action.description}
                  </span>
                )}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-ink-3)' }} strokeWidth={1.5} />
            </button>
          ))}
        </div>
      )}

      {secondaryActions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {secondaryActions.map(action => (
            <button
              key={action.capabilityId + action.label}
              type="button"
              onClick={() => onSelectNextCapability(action.capabilityId)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'transparent',
                fontSize: 11,
                fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink-2)',
                cursor: 'pointer',
                transition: 'border-color 0.1s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-ink)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-ink)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-ink-2)';
              }}
              title={action.description}
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onRegenerate}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'transparent',
              fontSize: 11,
              fontFamily: 'var(--font-ui)',
              color: 'var(--color-ink-3)',
              cursor: 'pointer',
            }}
            title="用相同 prompt 重新生成"
          >
            重新生成
          </button>
        </div>
      )}
    </div>
  );
}
