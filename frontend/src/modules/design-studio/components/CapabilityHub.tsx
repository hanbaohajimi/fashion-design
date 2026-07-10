import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Sparkles, Wand2, Palette, Layers, UserCircle, Shirt,
  X, Upload, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Circle,
} from 'lucide-react';
import {
  CAPABILITIES,
  CAPABILITY_GROUPS,
  DEFAULT_CAPABILITY_ID,
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
  index: number;
  preview: string;
  displayName: string;
}

interface CapabilityHubProps {
  sessionImages: SessionImage[];
  uploadedAssets: UploadedAsset[];
  resources: SessionResources;
  disabled?: boolean;
  /** 当前激活的能力 id */
  activeCapabilityId?: CapabilityId;
  /** 用户切换能力时调用（传能力 id） */
  onCapabilityChange?: (capabilityId: CapabilityId) => void;
  /** 用户最终确认能力 + 资源后调用，宿主负责把 finalPrompt 填到输入框 */
  onPick: (capabilityId: CapabilityId, finalPrompt: string) => void;
  /** 引导用户上传指定类型的图 */
  onRequestUpload?: (need: 'dress' | 'pattern' | 'model') => void;
}

const NEED_LABEL: Record<'dress' | 'model' | 'pattern', string> = {
  dress: '服装图',
  model: '人物图',
  pattern: '图案图',
};

/**
 * 能力分组任务选择器。
 * - Group1「从零开始」：完整卡片，默认展开
 * - Group2/3：紧凑列表行，可折叠
 */
export default function CapabilityHub({
  sessionImages,
  uploadedAssets,
  resources,
  disabled = false,
  activeCapabilityId = DEFAULT_CAPABILITY_ID,
  onCapabilityChange,
  onPick,
  onRequestUpload,
}: CapabilityHubProps) {
  // 组2/3 折叠状态
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    edit: false,
    showcase: false,
  });
  // 当点击 blocked 能力时展开的 inline 说明
  const [blockedCapId, setBlockedCapId] = useState<CapabilityId | null>(null);
  const blockedRef = useRef<HTMLDivElement>(null);

  const hints = useMemo(() => getCapabilityHints(resources), [resources]);

  // 点击外部关闭 blocked 说明
  useEffect(() => {
    if (!blockedCapId) return;
    const close = (e: MouseEvent) => {
      if (blockedRef.current && !blockedRef.current.contains(e.target as Node)) {
        setBlockedCapId(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [blockedCapId]);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const handleCapabilityClick = (cap: CapabilityDef) => {
    if (disabled) return;
    const hint = hints[cap.id];

    // 通知父组件切换当前能力
    onCapabilityChange?.(cap.id);

    if (hint.ready || cap.needs.length === 0) {
      // 资源充足或不需要底图 — 直接填入 prompt 模板
      onPick(cap.id, cap.promptTemplate);
      setBlockedCapId(null);
    } else {
      // 资源不足 — 展开 inline 说明
      setBlockedCapId(prev => (prev === cap.id ? null : cap.id));
    }
  };

  const getCapabilityStatusIcon = (cap: CapabilityDef) => {
    const hint = hints[cap.id];
    const isActive = cap.id === activeCapabilityId;

    if (isActive) {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: 'var(--color-ink)',
            flexShrink: 0,
          }}
          aria-label="当前任务"
        >
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#FBFAF6' }} />
        </span>
      );
    }
    if (cap.needs.length === 0) {
      return <Circle className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-ink-4)' }} strokeWidth={1} />;
    }
    if (hint.ready) {
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--signal-green, #27ae60)' }} strokeWidth={1.5} />;
    }
    return <AlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-ink-4)' }} strokeWidth={1} />;
  };

  const renderBlockedPanel = (cap: CapabilityDef) => {
    if (blockedCapId !== cap.id) return null;
    const hint = hints[cap.id];

    return (
      <div
        ref={blockedRef}
        style={{
          marginTop: 6,
          padding: '10px 12px',
          background: 'var(--color-paper)',
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          fontSize: 11,
          color: 'var(--color-ink-2)',
          fontFamily: 'var(--font-ui)',
        }}
      >
        <p style={{ marginBottom: 8, fontWeight: 500, color: 'var(--color-ink)' }}>
          当前任务需要：
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
          {cap.needs.map(n => {
            const isMissing = hint.missing.includes(n);
            return (
              <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {isMissing ? (
                  <span style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid var(--color-ink-4)', flexShrink: 0, display: 'inline-block' }} />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--signal-green, #27ae60)' }} strokeWidth={1.5} />
                )}
                <span style={{ color: isMissing ? 'var(--color-ink-2)' : 'var(--color-ink-3)' }}>
                  {NEED_LABEL[n]}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {hint.missing.includes('dress') && (
            <button
              type="button"
              onClick={() => { onRequestUpload?.('dress'); setBlockedCapId(null); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                fontSize: 11, fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink)', cursor: 'pointer',
              }}
            >
              <Upload className="h-3 w-3" strokeWidth={1.5} />
              上传服装图
            </button>
          )}
          {hint.missing.includes('pattern') && (
            <button
              type="button"
              onClick={() => { onRequestUpload?.('pattern'); setBlockedCapId(null); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                fontSize: 11, fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink)', cursor: 'pointer',
              }}
            >
              <Upload className="h-3 w-3" strokeWidth={1.5} />
              上传图案图
            </button>
          )}
          {hint.missing.includes('model') && (
            <button
              type="button"
              onClick={() => { onRequestUpload?.('model'); setBlockedCapId(null); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                fontSize: 11, fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink)', cursor: 'pointer',
              }}
            >
              <Upload className="h-3 w-3" strokeWidth={1.5} />
              上传人物图
            </button>
          )}
          {sessionImages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onCapabilityChange?.(cap.id);
                onPick(cap.id, `${cap.promptTemplate}（让 AI 自动从已有资源中选择合适的图）`);
                setBlockedCapId(null);
              }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                fontSize: 11, fontFamily: 'var(--font-ui)',
                color: 'var(--color-ink-2)', cursor: 'pointer',
              }}
            >
              让 AI 自动选图
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setBlockedCapId(null)}
          style={{
            position: 'absolute', top: 8, right: 8, padding: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-ink-3)',
          }}
          aria-label="关闭"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  };

  /** 渲染 Group1（从零开始）— 完整行样式 */
  const renderCreateGroup = () => {
    const group = CAPABILITY_GROUPS.find(g => g.id === 'create')!;
    const caps = group.capabilityIds.map(id => CAPABILITIES.find(c => c.id === id)!);

    return (
      <div style={{ marginBottom: 8 }}>
        <p
          style={{
            fontSize: 9,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--color-ink-4)',
            fontFamily: 'var(--font-ui)',
            marginBottom: 6,
            paddingLeft: 2,
          }}
        >
          {group.label}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {caps.map(cap => {
            const Icon = ICON_MAP[cap.iconName];
            const isActive = cap.id === activeCapabilityId;
            const isFirst = cap.id === DEFAULT_CAPABILITY_ID;

            return (
              <div key={cap.id} style={{ position: 'relative' }}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => handleCapabilityClick(cap)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: isActive
                      ? '1.5px solid var(--color-ink)'
                      : '1px solid var(--color-border-soft, var(--color-border))',
                    background: isActive ? 'var(--color-paper)' : 'transparent',
                    textAlign: 'left',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: isActive ? 'var(--color-ink)' : 'var(--color-surface-2, var(--color-surface))',
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    <Icon
                      className="h-3 w-3"
                      strokeWidth={1.5}
                      style={{ color: isActive ? '#FBFAF6' : 'var(--color-ink-2)' }}
                    />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontFamily: 'var(--font-ui)',
                          fontWeight: isActive ? 600 : 500,
                          color: isActive ? 'var(--color-ink)' : 'var(--color-ink-2)',
                          letterSpacing: '-0.005em',
                        }}
                      >
                        {cap.displayTitle}
                      </span>
                      {isActive && (
                        <span
                          style={{
                            fontSize: 9,
                            fontFamily: 'var(--font-ui)',
                            letterSpacing: '0.08em',
                            color: 'var(--color-ink-3)',
                            textTransform: 'uppercase',
                          }}
                        >
                          当前任务
                        </span>
                      )}
                      {!isActive && isFirst && (
                        <span
                          style={{
                            fontSize: 9,
                            fontFamily: 'var(--font-ui)',
                            letterSpacing: '0.08em',
                            color: 'var(--color-ink-4)',
                            textTransform: 'uppercase',
                          }}
                        >
                          推荐
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: 'var(--font-ui)',
                        color: 'var(--color-ink-3)',
                        display: 'block',
                        lineHeight: 1.4,
                      }}
                    >
                      {cap.subtitle}
                    </span>
                  </span>
                  <span style={{ flexShrink: 0, marginTop: 4 }}>
                    {getCapabilityStatusIcon(cap)}
                  </span>
                </button>
                {renderBlockedPanel(cap)}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /** 渲染 Group2/3（基于现有图片 / 展示与试穿）— 紧凑列表 */
  const renderCompactGroup = (groupId: 'edit' | 'showcase') => {
    const group = CAPABILITY_GROUPS.find(g => g.id === groupId)!;
    const caps = group.capabilityIds.map(id => CAPABILITIES.find(c => c.id === id)!);
    const isCollapsed = collapsedGroups[groupId] ?? false;

    return (
      <div key={groupId} style={{ marginBottom: 6 }}>
        <button
          type="button"
          onClick={() => toggleGroup(groupId)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            width: '100%',
            padding: '2px 2px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            marginBottom: isCollapsed ? 0 : 4,
          }}
        >
          <p
            style={{
              fontSize: 9,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--color-ink-4)',
              fontFamily: 'var(--font-ui)',
              flex: 1,
              textAlign: 'left',
            }}
          >
            {group.label}
          </p>
          {isCollapsed
            ? <ChevronDown className="h-3 w-3" style={{ color: 'var(--color-ink-4)' }} strokeWidth={1.5} />
            : <ChevronUp className="h-3 w-3" style={{ color: 'var(--color-ink-4)' }} strokeWidth={1.5} />
          }
        </button>
        {!isCollapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {caps.map(cap => {
              const Icon = ICON_MAP[cap.iconName];
              const isActive = cap.id === activeCapabilityId;
              const hint = hints[cap.id];
              const isBlocked = !hint.ready && cap.needs.length > 0;

              // P1-4: generate_model 动态文案 — 后端不接受图片，需在描述中说明
              const dynamicSubtitle = cap.id === 'generate_model' && resources.hasDress
                ? '展示当前设计（在描述中说明服装特征）'
                : cap.subtitle;
              const dynamicDisplayTitle = cap.id === 'generate_model' && resources.hasDress
                ? '生成模特展示图'
                : cap.displayTitle;

              return (
                <div key={cap.id} style={{ position: 'relative' }}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => handleCapabilityClick(cap)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: isActive
                        ? '1.5px solid var(--color-ink)'
                        : '1px solid transparent',
                      background: isActive ? 'var(--color-paper)' : 'transparent',
                      textAlign: 'left',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.4 : 1,
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                    onMouseEnter={e => {
                      if (!isActive && !disabled) {
                        (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-paper)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isActive) {
                        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                      }
                    }}
                  >
                    <Icon
                      className="h-3 w-3 shrink-0"
                      strokeWidth={1.5}
                      style={{ color: isActive ? 'var(--color-ink)' : 'var(--color-ink-3)' }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          fontFamily: 'var(--font-ui)',
                          fontWeight: isActive ? 600 : 400,
                          color: isActive ? 'var(--color-ink)' : 'var(--color-ink-2)',
                          letterSpacing: '-0.005em',
                        }}
                      >
                        {dynamicDisplayTitle}
                      </span>
                      {/* generate_model 有服装图时提示注意事项 */}
                      {cap.id === 'generate_model' && resources.hasDress && !isActive && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 9,
                            fontFamily: 'var(--font-ui)',
                            color: 'var(--color-ink-4)',
                            marginTop: 1,
                          }}
                        >
                          {dynamicSubtitle}
                        </span>
                      )}
                    </span>
                    {isActive && (
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: 'var(--font-ui)',
                          letterSpacing: '0.08em',
                          color: 'var(--color-ink-3)',
                          textTransform: 'uppercase',
                          flexShrink: 0,
                        }}
                      >
                        当前
                      </span>
                    )}
                    {!isActive && isBlocked && (
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: 'var(--font-ui)',
                          color: 'var(--color-ink-4)',
                          flexShrink: 0,
                        }}
                        title={`需要：${hint.missing.map(m => NEED_LABEL[m]).join('、')}`}
                      >
                        需要图片
                      </span>
                    )}
                    {!isActive && hint.ready && cap.needs.length > 0 && (
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--signal-green, #27ae60)', flexShrink: 0 }} />
                    )}
                  </button>
                  {renderBlockedPanel(cap)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {renderCreateGroup()}
      {renderCompactGroup('edit')}
      {renderCompactGroup('showcase')}
    </div>
  );
}
