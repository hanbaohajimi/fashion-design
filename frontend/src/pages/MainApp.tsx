import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { Boxes, Plus, ArrowLeft, ChevronDown, LayoutGrid, ChartColumn, LibraryBig, Sparkles, UserRound } from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary';
import DesignStudioWorkspace from '../modules/design-studio/DesignStudioWorkspace';
import TrendAnalysisWorkspace from '../modules/trend-analysis/TrendAnalysisWorkspace';
import LibraryWorkspace from '../modules/library/LibraryWorkspace';
import TrendBoardWorkspace from '../modules/trends/TrendBoardWorkspace';
import type { Trend } from '../types/profile';

type WorkspaceType = 'design-studio' | 'trend-analysis' | 'library' | 'trends';

interface WorkspaceTab {
  id: string;
  type: WorkspaceType;
  title: string;
}

interface MainAppProps {
  user: { email: string; name: string; auth_token: string };
  onLogout: () => void;
  onBackToTools?: () => void;
  initialTool?: WorkspaceType;
}

const PRESETS: Record<WorkspaceType, { title: string; desc: string; icon: ReactNode; tone: string }> = {
  'design-studio': {
    title: 'AI 设计工作台',
    desc: '对话生图 · 画布编辑 · 虚拟试穿',
    icon: <Sparkles className="h-4 w-4" />,
    tone: 'bg-[color:var(--ink)] text-white',
  },
  'trend-analysis': {
    title: '趋势分析中心',
    desc: '趋势报告 · 热词追踪 · 季节分析',
    icon: <ChartColumn className="h-4 w-4" />,
    tone: 'bg-[color:var(--signal-blue)] text-white',
  },
  library: {
    title: '我的库',
    desc: '生成图片 · 合集管理 · 风格分析',
    icon: <LibraryBig className="h-4 w-4" />,
    tone: 'bg-[color:var(--warm-metal)] text-white',
  },
  trends: {
    title: '趋势探索',
    desc: '流行趋势 · 个性化推荐 · 设计灵感',
    icon: <LayoutGrid className="h-4 w-4" />,
    tone: 'bg-[color:var(--signal-green)] text-white',
  },
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
  const [pendingTrend, setPendingTrend] = useState<Map<string, Trend>>(new Map());
  const menuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(prev => new Set(prev).add(activeId));
  }, [activeId]);

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
    setTabs(prev => [...prev, t]);
    setActiveId(t.id);
    setShowMenu(false);
  }, []);

  const addDesignTabWithTrend = useCallback((trend: Trend) => {
    const t: WorkspaceTab = { id: nid(), type: 'design-studio', title: `设计 · ${trend.name_zh || trend.name}` };
    setPendingTrend(prev => new Map(prev).set(t.id, trend));
    setTabs(prev => [...prev, t]);
    setActiveId(t.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    let nextActive = activeId;
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      if (next.length && activeId === id) {
        const currentIndex = prev.findIndex(t => t.id === id);
        nextActive = next[Math.max(0, currentIndex - 1)]?.id || next[0].id;
      }
      return next.length ? next : prev;
    });
    if (nextActive !== activeId) setActiveId(nextActive);
    setMounted(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [activeId]);

  const initials = (user.name || user.email)[0]?.toUpperCase() || 'U';
  const activeTab = tabs.find(tab => tab.id === activeId) || tabs[0];

  return (
    <div className="app-shell flex h-full flex-col overflow-hidden">
      <header className="topbar">
        <button
          type="button"
          onClick={onBackToTools}
          className="flex items-center gap-3 px-3 py-2 text-left"
          style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer', transition: 'background 150ms' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--overlay-hover)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          title="返回工具选择"
        >
          <div style={{ display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', background: 'var(--color-gold)', color: 'var(--color-void)' }}>
            <Boxes className="h-4 w-4" />
          </div>
          <div className="hidden sm:block">
            <p style={{ fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-widest)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>AI Fashion</p>
            <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>Creative OS</p>
          </div>
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overflow-y-visible">
          {tabs.map(tab => {
            const preset = PRESETS[tab.type];
            const active = tab.id === activeId;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveId(tab.id)}
                className={`tab-item relative ${active ? 'active' : ''}`}
              >
                <span style={{
                  display: 'flex', width: 20, height: 20, alignItems: 'center', justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  background: active ? 'var(--color-gold)' : 'var(--overlay-medium)',
                  color: active ? 'var(--color-void)' : 'var(--color-ink-3)',
                }}>
                  {preset.icon}
                </span>
                <span className="truncate max-w-[140px]">{tab.title}</span>
                {tabs.length > 1 && (
                  <span
                    onClick={e => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    style={{
                      marginLeft: 4,
                      borderRadius: 'var(--radius-pill)',
                      padding: '1px 5px',
                      fontSize: 10,
                      background: 'var(--overlay-medium)',
                      color: 'var(--color-ink-3)',
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setShowMenu(v => !v)}
            className="btn-ghost btn-square text-white/70 hover:bg-white/10 hover:text-white"
            title="新建工作区"
          >
            <Plus className="h-4 w-4" />
          </button>
          {showMenu && (
            <div className="dropdown-enter" style={{
              position: 'absolute', right: 0, top: 'calc(100% + 8px)',
              zIndex: 999, width: 300,
              borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              boxShadow: 'var(--shadow-xl)',
              padding: 'var(--space-2)',
            }}>
              <div style={{ padding: 'var(--space-2) var(--space-3)', marginBottom: 'var(--space-2)' }}>
                <p className="subsection-title" style={{ marginBottom: 2 }}>新建工作区</p>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>选择一个新的工作入口。</p>
              </div>
              {(Object.entries(PRESETS) as [WorkspaceType, typeof PRESETS[WorkspaceType]][]).map(([type, preset]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addTab(type)}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'flex-start', gap: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)', padding: 'var(--space-3)',
                    textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer',
                    transition: 'background 150ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--overlay-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{
                    display: 'flex', width: 40, height: 40, flexShrink: 0,
                    alignItems: 'center', justifyContent: 'center',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-gold)', color: 'var(--color-void)',
                  }}>
                    {preset.icon}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-medium)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>
                      {preset.title}
                    </span>
                    <span style={{ marginTop: 2, display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>
                      {preset.desc}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative ml-2" ref={userMenuRef}>
          <button
            type="button"
            onClick={() => setShowUserMenu(v => !v)}
            className="flex items-center gap-3 px-3 py-2 text-left"
            style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'transparent', cursor: 'pointer', transition: 'background 150ms' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--overlay-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title={user.name}
          >
            <span style={{ display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'var(--color-gold)', fontSize: 12, fontWeight: 'var(--weight-medium)', color: 'var(--color-void)' }}>
              {initials}
            </span>
            <span className="hidden sm:block">
              <span style={{ display: 'block', fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-widest)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>Account</span>
              <span style={{ display: 'block', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>{user.name}</span>
            </span>
            <ChevronDown className="h-4 w-4" style={{ color: 'var(--color-ink-3)' }} />
          </button>
          {showUserMenu && (
            <div className="dropdown-enter" style={{
              position: 'absolute', right: 0, top: 'calc(100% + 8px)',
              zIndex: 999, width: 240,
              borderRadius: 'var(--radius-xl)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              boxShadow: 'var(--shadow-xl)',
              padding: 'var(--space-2)',
            }}>
              <div style={{ padding: 'var(--space-3)', borderBottom: '1px solid var(--color-border-subtle)', marginBottom: 4 }}>
                <p style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-ink)', fontFamily: 'var(--font-ui)' }}>{user.name}</p>
                <p style={{ marginTop: 2, fontSize: 'var(--text-xs)', color: 'var(--color-ink-3)', fontFamily: 'var(--font-ui)' }}>{user.email}</p>
              </div>
              {onBackToTools && (
                <button
                  type="button" onClick={onBackToTools}
                  className="btn-ghost"
                  style={{ width: '100%', justifyContent: 'flex-start', height: 36, padding: '0 var(--space-3)', fontSize: 'var(--text-sm)' }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  工具选择
                </button>
              )}
              <button
                type="button" onClick={onLogout}
                className="btn-ghost"
                style={{ width: '100%', justifyContent: 'flex-start', height: 36, padding: '0 var(--space-3)', fontSize: 'var(--text-sm)' }}
              >
                <UserRound className="h-4 w-4" />
                退出登录
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 relative min-h-0">
        {tabs.map(tab => (
          <div key={tab.id} className={`absolute inset-0 ${activeId === tab.id ? 'z-10 workspace-enter' : 'z-0 invisible'}`}>
            {mounted.has(tab.id) && (
              <ErrorBoundary fallbackLabel={tab.title}>
                {tab.type === 'design-studio' && <DesignStudioWorkspace user={user} initialTrend={pendingTrend.get(tab.id)} />}
                {tab.type === 'trend-analysis' && <TrendAnalysisWorkspace />}
                {tab.type === 'library' && (
                  <LibraryWorkspace user={user} onSwitchToDesignStudio={() => addTab('design-studio')} />
                )}
                {tab.type === 'trends' && (
                  <TrendBoardWorkspace user={user} onDesignThis={trend => addDesignTabWithTrend(trend)} />
                )}
              </ErrorBoundary>
            )}
          </div>
        ))}
        {!activeTab && (
          <div className="flex h-full items-center justify-center text-[color:var(--text-muted)]">
            没有可用工作区
          </div>
        )}
      </div>
    </div>
  );
}
