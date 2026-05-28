import { useState } from 'react';

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
    setTimeout(() => onSelect(tool), 600);
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
      {/* Background */}
      <div
        className="fixed inset-0 bg-cover bg-center scale-105"
        style={{
          backgroundImage: `url(https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?w=1920&q=80)`,
          filter: 'blur(1.5px)',
        }}
      />
      <div
        className="fixed inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      {/* Transition overlay */}
      {transitioning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ animation: 'toolTransition 0.6s ease-out forwards' }}>
          <div className="w-4 h-4 rounded-full" style={{ background: 'var(--gold)', animation: 'ripple 0.6s ease-out forwards' }} />
        </div>
      )}

      {/* Top bar: user info */}
      <div className="fixed top-0 left-0 right-0 z-20 flex items-center justify-end p-6 gap-3"
        style={{ animation: 'fadeInUp 0.6s var(--ease) 0.1s both' }}>
        <span className="text-white/60 text-[12px]">{user.name}</span>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold"
          style={{ border: '1.5px solid var(--gold)', color: 'var(--gold)' }}>
          {initials}
        </div>
        <button onClick={onLogout} className="text-white/50 hover:text-white/80 text-[12px] ml-2 transition-colors">
          退出
        </button>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center px-6 max-w-4xl w-full">
        {/* Welcome */}
        <h1
          className="font-display text-white text-center font-light leading-tight mb-4"
          style={{ fontSize: 'clamp(28px, 5vw, 48px)', animation: 'fadeInUp 0.8s var(--ease) 0.2s both' }}
        >
          {user.name}，今天想探索什么？
        </h1>
        <p
          className="text-white/70 text-center text-[15px] font-light leading-[1.8] mb-16"
          style={{ animation: 'fadeInUp 0.8s var(--ease) 0.5s both' }}
        >
          每一次选择，都是与美的新一次相遇
        </p>

        {/* Tool Cards */}
        <div className="flex flex-col sm:flex-row gap-6 w-full justify-center items-center">
          {/* Design Studio Card */}
          <button
            onClick={() => handleSelect('design-studio')}
            className="group w-[280px] h-[320px] rounded-2xl flex flex-col items-center justify-center gap-5 text-center transition-all duration-[400ms]"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              animation: 'fadeInUp 0.8s var(--ease) 0.7s both',
              cursor: 'pointer',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.16)';
              e.currentTarget.style.transform = 'translateY(-8px)';
              e.currentTarget.style.borderColor = 'rgba(201,169,110,0.6)';
              e.currentTarget.style.boxShadow = '0 20px 60px rgba(0,0,0,0.3)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <h2 className="font-display text-white text-[22px] font-normal">AI 设计工作台</h2>
            <p className="text-white/60 text-[13px] font-light leading-relaxed px-6">
              智能生成设计方案<br/>释放创意边界
            </p>
          </button>

          {/* Trend Analysis Card */}
          <button
            onClick={() => handleSelect('trend-analysis')}
            className="group w-[280px] h-[320px] rounded-2xl flex flex-col items-center justify-center gap-5 text-center transition-all duration-[400ms]"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.2)',
              animation: 'fadeInUp 0.8s var(--ease) 0.9s both',
              cursor: 'pointer',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.16)';
              e.currentTarget.style.transform = 'translateY(-8px)';
              e.currentTarget.style.borderColor = 'rgba(201,169,110,0.6)';
              e.currentTarget.style.boxShadow = '0 20px 60px rgba(0,0,0,0.3)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18" />
              <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
            </svg>
            <h2 className="font-display text-white text-[22px] font-normal">趋势分析中心</h2>
            <p className="text-white/60 text-[13px] font-light leading-relaxed px-6">
              洞察时尚脉搏<br/>读懂流行密码
            </p>
          </button>
        </div>
      </div>

      {/* Bottom brand */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-10"
        style={{ animation: 'fadeInUp 0.6s var(--ease) 1.2s both' }}>
        <p className="text-white/30 text-[11px] tracking-[0.2em] uppercase">
          AI Fashion Design Platform
        </p>
      </div>
    </div>
  );
}
