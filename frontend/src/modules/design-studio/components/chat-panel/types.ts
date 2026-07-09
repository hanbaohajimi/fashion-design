import type React from 'react';

export interface LocalAttachment {
  localId: string;
  file: File;
  preview: string;
  displayName: string;
}

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
  /** 外部控制的 session_id（个性化模式由 Workspace 预创建） */
  externalSessionId?: string;
  /** 当前设计线程 id；通常与 route chatId 相同，用于后端消息持久化。 */
  designId?: string;
  initialMessages?: ChatMessage[];
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  side?: 'left' | 'right';
  authToken?: string;
  mode?: 'personal' | 'designer';
  designerProjectId?: string | null;
  trendId?: string;
  trendEnabled?: boolean;
  onTrendToggle?: (trendId: string | undefined, enabled: boolean) => void;
  modeBar?: React.ReactNode;
  settingsButton?: React.ReactNode;
  firstRunPanel?: React.ReactNode;
  starterPrompt?: string;
  onStarterPromptConsumed?: () => void;
}
