import { ArrowRight, Sparkles, Layers3, Wand2 } from 'lucide-react';

interface LandingPageProps {
  onEnter: () => void;
}

export default function LandingPage({ onEnter }: LandingPageProps) {
  return (
    <div className="entry-shell">
      <div
        className="entry-media"
        style={{ backgroundImage: 'url(https://picsum.photos/id/1060/1920/1280)' }}
      />
      <div className="entry-overlay" />

      <div className="entry-frame">
        <div className="entry-panel">
          <section className="hero-copy">
            <div className="hero-kicker">
              <Sparkles className="h-3.5 w-3.5" />
              Fashion intelligence workspace
            </div>

            <h1 className="hero-title">AI Fashion Design Platform</h1>
            <p className="hero-subtitle">
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

          <aside className="surface-card p-5 md:p-6 text-[13px] text-white/86 bg-[rgba(255,255,255,0.08)] border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            <p className="section-label text-white/60">System Overview</p>
            <div className="mt-4 grid gap-3">
              {[
                ['设计工作台', '生成、编辑、预览、试穿一体化'],
                ['趋势分析', '内容流与洞察面板统一呈现'],
                ['我的库', '素材、合集和复用路径集中管理'],
              ].map(([title, desc]) => (
                <div key={title} className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
                  <div className="flex items-center gap-2 text-white">
                    <Layers3 className="h-4 w-4 text-[color:var(--warm-metal)]" />
                    <span className="font-semibold">{title}</span>
                  </div>
                  <p className="mt-1 text-white/70 leading-6">{desc}</p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
