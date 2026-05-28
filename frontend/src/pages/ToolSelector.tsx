import { useState } from 'react';
import { ArrowRight, Boxes, ChartColumn, Sparkles } from 'lucide-react';

interface ToolSelectorProps {
  user: { email: string; name: string };
  onSelect: (tool: 'design-studio' | 'trend-analysis') => void;
  onLogout: () => void;
}

export default function ToolSelector({ user, onSelect, onLogout }: ToolSelectorProps) {
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const initials = (user.name || user.email)[0]?.toUpperCase() || 'U';

  const handleSelect = (tool: 'design-studio' | 'trend-analysis') => {
    setTransitioning(tool);
    window.setTimeout(() => onSelect(tool), 360);
  };

  return (
    <div className="entry-shell">
      {transitioning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(240,244,249,0.95)' }}>
          <div className="flex h-16 w-16 items-center justify-center rounded-full border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', backdropFilter: 'blur(24px)' }}>
            <Sparkles className="h-6 w-6" style={{ color: 'var(--color-accent)' }} />
          </div>
        </div>
      )}

      <div className="entry-frame">
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex items-center justify-between gap-4 pb-8" style={{ color: 'var(--color-ink-2)' }}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ background: 'var(--color-accent)', color: '#FFFFFF' }}>
                <Boxes className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--color-ink-3)' }}>Workspace</p>
                <p className="text-[14px] font-semibold" style={{ color: 'var(--color-ink)' }}>{user.name}</p>
              </div>
            </div>
            <button type="button" onClick={onLogout} className="btn-ghost px-4">
              退出
            </button>
          </div>

          <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="hero-copy" style={{ color: 'var(--color-ink)' }}>
              <p className="hero-kicker w-max" style={{ color: 'var(--color-ink-3)', borderColor: 'var(--color-border-medium)', background: 'var(--color-surface-2)' }}>
                <ChartColumn className="h-3.5 w-3.5" />
                Choose your workspace
              </p>
              <h1 className="hero-title mt-5">今天要进入哪条工作流？</h1>
              <p className="hero-subtitle">
                设计工作台负责生成与编辑，趋势中心负责洞察与灵感。两个入口共用同一套项目上下文与视觉系统。
              </p>
            </div>

            <div className="grid gap-4">
              <button
                type="button"
                onClick={() => handleSelect('design-studio')}
                className="surface-card group flex min-h-[180px] flex-col justify-between p-5 text-left transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="flex items-center justify-between">
                  <div style={{ display: 'flex', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', background: 'var(--color-accent)', color: '#FFFFFF' }}>
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" style={{ color: 'var(--color-ink-3)' }} />
                </div>
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 'var(--weight-light)', letterSpacing: 'var(--tracking-tight)', color: 'var(--color-ink)' }}>AI 设计工作台</h2>
                  <p style={{ marginTop: 8, maxWidth: 360, fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-loose)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
                    从对话生成、草图编辑到预览与试穿，所有创作动作都在一个连续界面里完成。
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSelect('trend-analysis')}
                className="surface-card group flex min-h-[180px] flex-col justify-between p-5 text-left transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="flex items-center justify-between">
                  <div style={{ display: 'flex', width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border-medium)', color: 'var(--color-accent)' }}>
                    <ChartColumn className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" style={{ color: 'var(--color-ink-3)' }} />
                </div>
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 'var(--weight-light)', letterSpacing: 'var(--tracking-tight)', color: 'var(--color-ink)' }}>趋势分析中心</h2>
                  <p style={{ marginTop: 8, maxWidth: 360, fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-loose)', color: 'var(--color-ink-2)', fontFamily: 'var(--font-ui)' }}>
                    读取趋势、筛选热点、沉淀灵感，再把结果快速带回设计工作台继续创作。
                  </p>
                </div>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
