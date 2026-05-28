import { ArrowRight, Sparkles, Layers3, Wand2 } from 'lucide-react';

interface LandingPageProps {
  onEnter: () => void;
}

export default function LandingPage({ onEnter }: LandingPageProps) {
  return (
    <div className="entry-shell">
      <div className="entry-frame">
        <div className="entry-panel">
          <section className="hero-copy" style={{ color: 'var(--color-ink)' }}>
            <div className="hero-kicker" style={{ color: 'var(--color-ink-3)', borderColor: 'var(--color-border-medium)', background: 'var(--color-surface-2)' }}>
              <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--color-accent)' }} />
              Fashion intelligence workspace
            </div>

            <h1 className="hero-title">AI Fashion Design Platform</h1>
            <p className="hero-subtitle" style={{ color: 'var(--color-ink-2)' }}>
              用统一的设计语言连接灵感、趋势、项目与生成。
              进入后，你会在一个更轻、更快、更清晰的工作台里完成从洞察到创作的完整链路。
            </p>

            <div className="hero-actions">
              <button type="button" onClick={onEnter} className="btn-primary px-5">
                进入系统
                <ArrowRight className="h-4 w-4" />
              </button>
              <button type="button" className="btn-secondary px-5">
                <Wand2 className="h-4 w-4" />
                查看工作流
              </button>
            </div>
          </section>

          <aside className="surface-card p-5 md:p-6 text-[13px]">
            <p className="section-label" style={{ color: 'var(--color-ink-3)' }}>System Overview</p>
            <div className="mt-4 grid gap-3">
              {[
                ['设计工作台', '生成、编辑、预览、试穿一体化'],
                ['趋势分析', '内容流与洞察面板统一呈现'],
                ['我的库', '素材、合集和复用路径集中管理'],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-2xl px-4 py-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2">
                    <Layers3 className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
                    <span className="font-semibold" style={{ color: 'var(--color-ink)' }}>{title}</span>
                  </div>
                  <p className="mt-1 leading-6" style={{ color: 'var(--color-ink-2)' }}>{desc}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
