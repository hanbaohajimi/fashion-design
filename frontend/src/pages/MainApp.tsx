import { useState, useCallback, useRef, useEffect } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import DesignStudioWorkspace from '../workspaces/design-studio/DesignStudioWorkspace';
import TrendAnalysisWorkspace from '../workspaces/trend-analysis/TrendAnalysisWorkspace';

type WorkspaceType = 'design-studio' | 'trend-analysis';

interface WorkspaceTab { id: string; type: WorkspaceType; title: string; }

interface MainAppProps {
  user: { email: string; name: string };
  onLogout: () => void;
  onBackToTools?: () => void;
  initialTool?: WorkspaceType;
}

const PRESETS: Record<WorkspaceType, { title: string; desc: string; icon: string }> = {
  'design-studio': { title: 'AI 设计工作台', desc: '对话生图 · 画布编辑 · 虚拟试穿', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
  'trend-analysis': { title: '趋势分析中心', desc: '趋势报告 · 热词追踪 · 季节分析', icon: 'M3 3v18h18M9 17V9m4 8V5m4 12v-4' },
};

let _c = 0;
const nid = () => `ws-${++_c}`;

export default function MainApp({ user, onLogout, onBackToTools, initialTool }: MainAppProps) {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    const first: WorkspaceType = initialTool || 'design-studio';
    return [{ id: nid(), type: first, title: PRESETS[first].title }];
  });
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [showMenu, setShowMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mounted, setMounted] = useState<Set<string>>(new Set([tabs[0].id]));
  const menuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(p => new Set(p).add(activeId)); }, [activeId]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const addTab = useCallback((type: WorkspaceType) => {
    const t: WorkspaceTab = { id: nid(), type, title: PRESETS[type].title };
    setTabs(p => [...p, t]);
    setActiveId(t.id);
    setShowMenu(false);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(p => {
      const next = p.filter(t => t.id !== id);
      if (!next.length) return p;
      return next;
    });
    setActiveId(prev => {
      if (prev !== id) return prev;
      const remaining = tabs.filter(t => t.id !== id);
      return remaining.length ? remaining[Math.max(0, tabs.findIndex(t => t.id === id) - 1)].id : prev;
    });
    setMounted(p => { const n = new Set(p); n.delete(id); return n; });
  }, [tabs]);

  const initials = (user.name || user.email)[0]?.toUpperCase() || 'U';

  return (
    <div className="flex flex-col h-screen" style={{ background: 'var(--bg)' }}>
      {/* Tab Bar */}
      <header className="tab-bar">
        {/* Logo — clickable to go back to tool selector */}
        <button onClick={onBackToTools} className="flex items-center gap-2.5 pr-4 mr-2 hover:opacity-80 transition-opacity" title="返回工具选择">
          <div className="w-6 h-6 rounded-md flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--gold), #A8894E)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-[10px] font-medium tracking-[0.14em] uppercase" style={{ color: 'rgba(255,255,255,0.35)' }}>
            AI Fashion
          </span>
        </button>

        {/* Tabs */}
        <div className="flex items-end gap-px flex-1 min-w-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {tabs.map(tab => {
            const active = activeId === tab.id;
            const preset = PRESETS[tab.type];
            return (
              <div key={tab.id} onClick={() => setActiveId(tab.id)} className={`tab-item group ${active ? 'active' : ''}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={active ? 'opacity-60' : 'opacity-40'}>
                  <path d={preset.icon} />
                </svg>
                <span className="truncate max-w-[140px]">{tab.title}</span>
                {tabs.length > 1 && (
                  <span onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                    className={`p-0.5 rounded transition-all ml-1 hover:bg-white/10
                      ${active ? 'opacity-30 hover:opacity-80' : 'opacity-0 group-hover:opacity-30 hover:!opacity-80'}`}
                    style={{ color: active ? 'var(--text-secondary)' : 'rgba(255,255,255,0.5)' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* New tab */}
        <div className="relative" ref={menuRef}>
          <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 rounded-md transition-all"
            style={{ color: 'rgba(255,255,255,0.3)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.7)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.3)')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          {showMenu && (
            <div className="dropdown-enter absolute top-full right-0 mt-2 w-72 rounded-xl p-1.5 z-[999]"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
              <div className="px-3 pt-2 pb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>新建工作区</p>
              </div>
              {(Object.entries(PRESETS) as [WorkspaceType, typeof PRESETS[WorkspaceType]][]).map(([type, p]) => (
                <button key={type} onClick={() => addTab(type)}
                  className="flex items-start gap-3 w-full p-3 rounded-lg text-left hover:bg-[var(--bg-muted)] transition-colors">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: 'var(--gold-dim)', color: 'var(--gold)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d={p.icon} />
                    </svg>
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{p.title}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{p.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* User */}
        <div className="relative ml-3" ref={userMenuRef}>
          <button onClick={() => setShowUserMenu(!showUserMenu)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all"
            style={{ background: 'var(--gold)', color: 'var(--charcoal)' }} title={user.name}>
            {initials}
          </button>
          {showUserMenu && (
            <div className="dropdown-enter absolute top-full right-0 mt-2 w-56 rounded-xl p-2 z-[999]"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)' }}>
              <div className="px-3 py-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{user.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
              </div>
              {onBackToTools && (
                <button onClick={onBackToTools}
                  className="w-full mt-1 px-3 py-2 text-left text-[13px] rounded-lg hover:bg-[var(--bg-muted)] transition-colors"
                  style={{ color: 'var(--text-secondary)' }}>
                  工具选择
                </button>
              )}
              <button onClick={onLogout}
                className="w-full px-3 py-2 text-left text-[13px] rounded-lg hover:bg-[var(--bg-muted)] transition-colors"
                style={{ color: 'var(--text-secondary)' }}>
                退出登录
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Workspaces */}
      <div className="flex-1 relative min-h-0">
        {tabs.map(tab => (
          <div key={tab.id} className={`absolute inset-0 ${activeId === tab.id ? 'z-10 workspace-enter' : 'z-0 invisible'}`}>
            {mounted.has(tab.id) && (
              <ErrorBoundary fallbackLabel={tab.title}>
                {tab.type === 'design-studio' && <DesignStudioWorkspace />}
                {tab.type === 'trend-analysis' && <TrendAnalysisWorkspace />}
              </ErrorBoundary>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
