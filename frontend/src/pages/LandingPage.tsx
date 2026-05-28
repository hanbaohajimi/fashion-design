interface LandingPageProps {
  onEnter: () => void;
}

export default function LandingPage({ onEnter }: LandingPageProps) {
  return (
    <div className="relative h-screen w-full overflow-hidden">
      {/* Background: Art painting with gradient vignette */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=1920&q=85)`,
        }}
      />
      {/* Vignette overlay: darkened corners, clear center */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at center, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.55) 100%),
            linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.4) 100%)
          `,
          backdropFilter: 'blur(0.5px)',
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full px-6 text-center">
        {/* Main Title */}
        <h1
          className="landing-title font-display text-white font-black leading-[1.1] tracking-tight"
          style={{
            fontSize: 'clamp(48px, 8vw, 96px)',
            textShadow: '0 2px 24px rgba(0,0,0,0.3), 0 0 80px rgba(0,0,0,0.15)',
          }}
        >
          时尚设计
        </h1>

        {/* Subtitle */}
        <p
          className="landing-subtitle mt-10 max-w-lg text-white/85 leading-[2.2] font-light"
          style={{
            fontSize: 'clamp(14px, 2vw, 18px)',
            textShadow: '0 1px 8px rgba(0,0,0,0.3)',
            fontFamily: 'var(--font-body)',
          }}
        >
          在布料的褶皱间，捕捉时代的呼吸<br />
          用数据读懂美的流向<br />
          以 AI 重新定义设计的边界
        </p>

        {/* CTA Button */}
        <button
          onClick={onEnter}
          className="landing-cta mt-12 px-12 py-3.5 border-[1.5px] border-white text-white text-[14px] font-medium tracking-[0.15em] uppercase
            bg-transparent hover:bg-white/[0.12] transition-all duration-300 ease-out active:scale-[0.97]"
          style={{ fontFamily: 'var(--font-body)' }}
        >
          进入系统
        </button>

        {/* Scroll hint */}
        <div className="landing-scroll absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <span className="text-white/60 text-[11px] tracking-[0.2em] uppercase" style={{ fontFamily: 'var(--font-body)' }}>
            Scroll to explore
          </span>
          <svg className="landing-scroll-arrow w-4 h-4 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M7 13l5 5 5-5M7 6l5 5 5-5" />
          </svg>
        </div>
      </div>
    </div>
  );
}
