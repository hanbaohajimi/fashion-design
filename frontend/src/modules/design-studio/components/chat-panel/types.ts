import type React from 'react';

/** 附件在当前能力中的角色 */
export type AttachmentRole = 'dress' | 'pattern' | 'model' | 'reference';

/** 附件的来源 */
export type AttachmentSource = 'upload' | 'canvas' | 'generated';

export interface LocalAttachment {
  localId: string;
  /**
   * 真实 File 对象（来自用户上传）。
   * canvas/generated 来源的附件优先使用 sourceUrl，file 可为空。
   * 发送时：只上传 file 且 file.size > 0 的附件；
   * sourceUrl 来源的附件会在 send() 前按需下载为真实 Blob。
   */
  file?: File;
  /**
   * 远端/本地图片 URL（画布截图 dataUrl 或已生成图片 URL）。
   * 当 file 缺失或 size === 0 时，发送前从此 URL 下载为 File。
   */
  sourceUrl?: string;
  /** 显示用的预览 URL（与 sourceUrl 相同，或 URL.createObjectURL）*/
  preview: string;
  displayName: string;
  /** 在需要区分图片角色的能力（图案迁移/虚拟试穿）中的语义角色 */
  role?: AttachmentRole;
  /** 附件来源，用于决定上传策略 */
  source: AttachmentSource;
}

/** 能力的当前可用状态 */
export type CapabilityStatus =
  | 'idle'       // 等待用户选择或输入（不需要底图的能力）
  | 'ready'      // 当前能力所需条件已满足
  | 'blocked'    // 缺少当前能力需要的素材
  | 'generating' // 任务执行中
  | 'result'     // 已有结果
  | 'error';     // 执行失败

export interface ChatImage {
  url: string;
  type: string;
}

export type ChatTaskPhase = 'request' | 'analysis' | 'generation' | 'finalizing';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: ChatImage[];
  timestamp: Date;
  isStreaming?: boolean;
  status?: string;
  taskPhase?: ChatTaskPhase;
  startedAt?: number;
  durationSeconds?: number;
  uploadPreview?: string;
  uploadPreviews?: string[];
  isError?: boolean;
  failedMessage?: string;
}

export interface StreamEvent {
  type: 'status' | 'image' | 'message' | 'error' | 'done';
  content?: string;
  url?: string;
  images?: ChatImage[];
  [key: string]: unknown;
}

export type TrendHotItem = {
  keyword: string;
  count: number;
  category: string;
  categoryLabel: string;
};

export type TrendHotStatus = 'loading' | 'ok' | 'empty' | 'error';

export interface TrendHotBlock {
  key: string;
  label: string;
  items: TrendHotItem[];
}

export interface ChatPanelProps {
  onEditImage: (imageUrl: string) => void;
  onPreviewImage: (imageUrl: string) => void;
  onImageGenerated?: (image: ChatImage) => void;
  onAddToCanvas?: (imageUrl: string) => void;
  pendingFromCanvas?: string | null;
  onClearPendingFromCanvas?: () => void;
  /** 同步当前对话 session_id，供像素编辑等调用后端时写入同一会话目录 */
  onSessionIdChange?: (sessionId: string) => void;
  /** 外部控制的 session_id。 */
  externalSessionId?: string;
  /** 当前设计线程 id；通常与 route chatId 相同，用于后端消息持久化。 */
  designId?: string;
  initialMessages?: ChatMessage[];
  /** 画布当前选中图片 URL（来自 Fabric.js 选中事件），可被能力作为素材 */
  selectedCanvasImageUrl?: string | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  side?: 'left' | 'right';
  authToken?: string;
  projectId?: string | null;
  trendId?: string;
  trendEnabled?: boolean;
  onTrendToggle?: (trendId: string | undefined, enabled: boolean) => void;
  settingsButton?: React.ReactNode;
  firstRunPanel?: React.ReactNode;
  starterPrompt?: string;
  onStarterPromptConsumed?: () => void;
}
