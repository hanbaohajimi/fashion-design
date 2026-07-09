import React from 'react';
import { AlertCircle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';

type WorkspaceStateKind = 'empty' | 'error' | 'loading';

interface WorkspaceStateAction {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface WorkspaceStateProps {
  kind?: WorkspaceStateKind;
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: WorkspaceStateAction;
  secondaryAction?: WorkspaceStateAction;
  compact?: boolean;
}

export function WorkspaceState({
  kind = 'empty',
  eyebrow,
  title,
  description,
  icon,
  action,
  secondaryAction,
  compact = false,
}: WorkspaceStateProps) {
  const defaultIcon = kind === 'error'
    ? <AlertCircle size={21} strokeWidth={1.5} />
    : kind === 'loading'
      ? <LoaderCircle size={21} strokeWidth={1.5} className="animate-spin" />
      : <Inbox size={21} strokeWidth={1.5} />;

  return (
    <section
      className={`workspace-state workspace-state--${kind} ${compact ? 'workspace-state--compact' : ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
    >
      <div className="workspace-state__mark">{icon || defaultIcon}</div>
      {eyebrow && <p className="workspace-state__eyebrow">{eyebrow}</p>}
      <h2 className="workspace-state__title">{title}</h2>
      {description && <p className="workspace-state__description">{description}</p>}
      {(action || secondaryAction) && (
        <div className="workspace-state__actions">
          {action && (
            <button
              type="button"
              className="workspace-state__action workspace-state__action--primary"
              onClick={action.onClick}
              disabled={action.disabled}
            >
              {action.icon}
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              className="workspace-state__action workspace-state__action--secondary"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
            >
              {secondaryAction.icon}
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

interface WorkspaceSkeletonProps {
  variant?: 'grid' | 'rows';
  count?: number;
  label?: string;
}

export function WorkspaceSkeleton({
  variant = 'grid',
  count = 6,
  label = '正在加载内容',
}: WorkspaceSkeletonProps) {
  return (
    <div className={`workspace-skeleton workspace-skeleton--${variant}`} role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <div className="workspace-skeleton__item" key={index}>
          <div className="skeleton workspace-skeleton__media" />
          <div className="skeleton workspace-skeleton__line workspace-skeleton__line--strong" />
          <div className="skeleton workspace-skeleton__line" />
        </div>
      ))}
    </div>
  );
}

interface Props {
  children: React.ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.fallbackLabel || 'Unknown', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="workspace-state-boundary">
          <WorkspaceState
            kind="error"
            eyebrow={this.props.fallbackLabel || '工作区'}
            title="这个工作区暂时无法显示"
            description={this.state.error?.message || '页面运行时发生异常，可以先重试当前工作区。'}
            action={{
              label: '重试',
              icon: <RefreshCw size={14} strokeWidth={1.5} />,
              onClick: () => this.setState({ hasError: false, error: undefined }),
            }}
            secondaryAction={{
              label: '刷新页面',
              onClick: () => window.location.reload(),
            }}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
