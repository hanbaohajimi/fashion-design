/**
 * CapabilityMaterialPanel — 根据当前能力渲染明确的素材角色插槽
 *
 * 适用于需要图片输入的能力：
 *   - edit_image:       1 槽（dress）
 *   - transfer_pattern: 2 槽（dress + pattern）
 *   - try_on:           2 槽（model + dress）
 *
 * text_to_image / draw_sketch / generate_model 返回 null（不需要图片插槽）。
 */
import React, { useRef } from 'react';
import { Upload, X, RefreshCw, ImagePlus } from 'lucide-react';
import type { AttachmentRole, LocalAttachment } from './types';
import type { CapabilityId } from '../../utils/capabilities';

// ── 角色中文标签 ────────────────────────────────────────────────────────────
const ROLE_ZH: Record<AttachmentRole, string> = {
  dress:     '服装图',
  pattern:   '图案图',
  model:     '人物图',
  reference: '参考图',
};

// ── 每个能力需要哪些角色插槽（有序！顺序 = 后端上传顺序）───────────────────
const CAPABILITY_SLOTS: Partial<Record<CapabilityId, AttachmentRole[]>> = {
  edit_image:        ['dress'],
  transfer_pattern:  ['dress', 'pattern'],   // dress 第一，pattern 第二
  try_on:            ['model', 'dress'],      // model 第一，dress 第二
};

// ── 每个插槽对"从画布添加"是否有意义 ─────────────────────────────────────
const CANVAS_APPLICABLE: Partial<Record<AttachmentRole, boolean>> = {
  dress: true,
  model: true,
};

// ── MaterialSlot ──────────────────────────────────────────────────────────
interface MaterialSlotProps {
  role: AttachmentRole;
  attachment?: LocalAttachment;       // 当前已分配的附件
  required?: boolean;                 // 是否必填
  disabled?: boolean;
  selectedCanvasImageUrl?: string | null;
  onUpload: (role: AttachmentRole) => void;
  onRemove: (localId: string) => void;
  onUseCanvas: (role: AttachmentRole) => void;
}

function MaterialSlot({
  role,
  attachment,
  required = false,
  disabled = false,
  selectedCanvasImageUrl,
  onUpload,
  onRemove,
  onUseCanvas,
}: MaterialSlotProps) {
  const label = ROLE_ZH[role];
  const canUseCanvas = CANVAS_APPLICABLE[role] && !!selectedCanvasImageUrl;
  const isFilled = !!attachment;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* 标签行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: 'var(--font-ui)',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: isFilled ? 'var(--color-ink-2)' : required ? 'var(--color-ink)' : 'var(--color-ink-3)',
          }}
        >
          {label}
        </span>
        {required && !isFilled && (
          <span
            style={{
              fontSize: 9,
              fontFamily: 'var(--font-ui)',
              color: 'var(--color-ink-3)',
              letterSpacing: '0.04em',
            }}
          >
            需要此素材
          </span>
        )}
        {isFilled && (
          <span
            style={{
              fontSize: 9,
              fontFamily: 'var(--font-ui)',
              color: 'var(--color-ink-4)',
              letterSpacing: '0.04em',
            }}
          >
            已添加
          </span>
        )}
      </div>

      {/* 槽位主体 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          borderRadius: 7,
          border: isFilled
            ? '1.5px solid var(--color-ink)/20'
            : required
              ? '1.5px dashed var(--color-ink)/40'
              : '1px dashed var(--color-border)',
          background: isFilled ? 'var(--color-paper)' : 'var(--color-surface)',
          minHeight: 44,
        }}
      >
        {isFilled ? (
          // 已填充：显示缩略图 + 更换/移除
          <>
            <img
              src={attachment!.preview}
              alt=""
              style={{
                width: 34,
                height: 34,
                objectFit: 'cover',
                borderRadius: 4,
                flexShrink: 0,
                border: '1px solid var(--color-border)',
              }}
            />
            <span
              style={{
                flex: 1,
                fontSize: 10,
                fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink-2)',
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {attachment!.displayName}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onUpload(role)}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid var(--color-border)',
                background: 'white',
                fontSize: 10,
                fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink-2)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                flexShrink: 0,
              }}
              title="更换图片"
            >
              <RefreshCw style={{ width: 10, height: 10 }} strokeWidth={1.5} />
              更换
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(attachment!.localId)}
              style={{
                padding: '2px 4px',
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
                color: 'var(--color-ink-3)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}
              title="移除"
            >
              <X style={{ width: 12, height: 12 }} strokeWidth={1.5} />
            </button>
          </>
        ) : (
          // 未填充：上传 + 从画布选择
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onUpload(role)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                flex: 1,
                padding: '4px 0',
                background: 'none',
                border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: 'var(--color-ink-3)',
                fontSize: 11,
                fontFamily: 'var(--font-ui)',
                textAlign: 'left',
              }}
            >
              <Upload style={{ width: 13, height: 13 }} strokeWidth={1.5} />
              上传{label}
            </button>
            {canUseCanvas && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onUseCanvas(role)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 7px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-paper)',
                  fontSize: 10,
                  fontFamily: 'var(--font-ui)',
                  color: 'var(--color-ink-2)',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  flexShrink: 0,
                }}
                title={`使用画布中当前选中图片作为${label}`}
              >
                <ImagePlus style={{ width: 10, height: 10 }} strokeWidth={1.5} />
                从画布
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── CapabilityMaterialPanel ───────────────────────────────────────────────
export interface CapabilityMaterialPanelProps {
  activeCapabilityId: CapabilityId;
  attachedAssets: LocalAttachment[];
  disabled?: boolean;
  selectedCanvasImageUrl?: string | null;
  /** 触发文件上传输入框 click，同时指定此次上传的目标 role */
  onRequestUpload: (role: AttachmentRole) => void;
  /** 移除某个附件 */
  onRemoveAttachment: (localId: string) => void;
  /** 将画布图片加入附件并设定 role（由 ChatPanel 处理异步下载）*/
  onAddCanvasAsset: (role: AttachmentRole) => void;
}

export default function CapabilityMaterialPanel({
  activeCapabilityId,
  attachedAssets,
  disabled = false,
  selectedCanvasImageUrl,
  onRequestUpload,
  onRemoveAttachment,
  onAddCanvasAsset,
}: CapabilityMaterialPanelProps) {
  const slots = CAPABILITY_SLOTS[activeCapabilityId];

  // 不需要素材槽的能力（text_to_image / draw_sketch / generate_model）
  if (!slots || slots.length === 0) return null;

  // 从 attachedAssets 中找每个槽位的附件（取第一个匹配的）
  const findSlotAttachment = (role: AttachmentRole): LocalAttachment | undefined =>
    attachedAssets.find(a => a.role === role);

  return (
    <div
      style={{
        padding: '10px 16px',
        borderTop: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {slots.map(role => (
        <MaterialSlot
          key={role}
          role={role}
          attachment={findSlotAttachment(role)}
          required
          disabled={disabled}
          selectedCanvasImageUrl={selectedCanvasImageUrl}
          onUpload={onRequestUpload}
          onRemove={onRemoveAttachment}
          onUseCanvas={onAddCanvasAsset}
        />
      ))}
    </div>
  );
}

// ── Exports for external use ──────────────────────────────────────────────
export { CAPABILITY_SLOTS };
export type { MaterialSlotProps };
