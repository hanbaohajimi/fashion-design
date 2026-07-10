import { ChevronLeft, ChevronRight, RotateCcw, Share2, SquarePlus, Sparkles } from 'lucide-react';

interface ChatHeaderProps {
  messagesCount: number;
  chatSessionTitle: string;
  isRight: boolean;
  onAddToLibrary: () => void;
  onShareConversation: () => void;
  onNewChat: () => void;
  onToggleCollapse?: () => void;
  settingsButton?: React.ReactNode;
}

export function ChatHeader({
  messagesCount,
  chatSessionTitle,
  isRight,
  onAddToLibrary,
  onShareConversation,
  onNewChat,
  onToggleCollapse,
  settingsButton,
}: ChatHeaderProps) {
  const CollapseIcon = isRight ? ChevronRight : ChevronLeft;

  return (
    <div className="chat-header">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0, flex: 1 }}>
        <div className="chat-header-mark">
          <Sparkles className="w-3.5 h-3.5" strokeWidth={1.5} />
        </div>
        <div style={{ minWidth: 0 }}>
          <p className="kicker" style={{ fontSize: 9, letterSpacing: '0.28em' }}>AI DESIGN ASSISTANT</p>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 'var(--weight-light)',
              letterSpacing: '-0.005em',
              color: 'var(--color-ink)',
              lineHeight: 1.1,
              marginTop: 3,
            }}
          >
            Fashion Studio
          </h1>
          {messagesCount > 0 && (
            <p
              title={chatSessionTitle}
              style={{
                marginTop: 4,
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 11,
                color: 'var(--color-ink-3)',
                fontFamily: 'var(--font-ui)',
                letterSpacing: '0.02em',
                fontStyle: 'italic',
              }}
            >
              {chatSessionTitle}
            </p>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        {settingsButton}
        <button
          type="button"
          onClick={onAddToLibrary}
          className="icon-btn-editorial"
          title="复制最近生成图链接"
        >
          <SquarePlus className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={onShareConversation}
          className="icon-btn-editorial"
          title="复制页面链接"
        >
          <Share2 className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={onNewChat}
          className="icon-btn-editorial"
          title="新对话"
        >
          <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
        </button>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="icon-btn-editorial"
            title="收起侧栏（Ctrl+B）"
          >
            <CollapseIcon className="w-3.5 h-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
}
