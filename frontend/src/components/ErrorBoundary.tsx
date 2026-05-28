import React from 'react';

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
        <div className="flex items-center justify-center h-full" style={{ background: 'var(--surface-2)' }}>
          <div className="text-center max-w-sm px-8 py-12">
            {/* Error icon */}
            <div className="mx-auto mb-6 w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--accent-primary-subtle)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>
            <h2 className="text-[15px] font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              {this.props.fallbackLabel || '模块'}加载异常
            </h2>
            <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'var(--text-tertiary)' }}>
              {this.state.error?.message || '发生了未预期的错误'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: undefined })}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[13px] font-medium text-white rounded-lg transition-all hover:opacity-90"
              style={{ background: 'var(--accent-primary)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
