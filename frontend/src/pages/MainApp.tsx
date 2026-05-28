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
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-left hover:bg-white/10"
          title="返回工具选择"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[color:var(--warm-metal)] text-white">
            <Boxes className="h-4 w-4" />
          </div>
          <div className="hidden sm:block">
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/35">AI Fashion</p>
            <p className="text-[13px] font-semibold text-white/90">Creative OS</p>
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
                <span className={`flex h-5 w-5 items-center justify-center rounded-md ${active ? 'bg-[color:var(--ink)] text-white' : 'bg-white/8 text-white/55'}`}>
                  {preset.icon}
                </span>
                <span className="truncate max-w-[140px]">{tab.title}</span>
                {tabs.length > 1 && (
                  <span
                    onClick={e => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-black/8 text-[color:var(--text-secondary)]' : 'bg-white/8 text-white/45'}`}
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
            <div className="dropdown-enter absolute right-0 top-full z-[999] mt-2 w-80 rounded-3xl border border-[color:var(--border-soft)] bg-white p-2 shadow-[0_18px_42px_rgba(16,17,20,0.16)]">
              <div className="px-3 py-2">
                <p className="section-label">新建工作区</p>
                <p className="mt-1 text-[13px] text-[color:var(--text-secondary)]">选择一个新的工作入口。</p>
              </div>
              {(Object.entries(PRESETS) as [WorkspaceType, typeof PRESETS[WorkspaceType]][]).map(([type, preset]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addTab(type)}
                  className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left hover:bg-[color:var(--paper)]"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${preset.tone}`}>
                    {preset.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-[color:var(--text-primary)]">{preset.title}</span>
                    <span className="mt-0.5 block text-[12px] leading-5 text-[color:var(--text-secondary)]">{preset.desc}</span>
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
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-left hover:bg-white/10"
            title={user.name}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[color:var(--warm-metal)] text-[12px] font-semibold text-white">
              {initials}
            </span>
            <span className="hidden sm:block">
              <span className="block text-[10px] uppercase tracking-[0.16em] text-white/35">Account</span>
              <span className="block max-w-[140px] truncate text-[13px] font-medium text-white/90">{user.name}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-white/45" />
          </button>
          {showUserMenu && (
            <div className="dropdown-enter absolute right-0 top-full z-[999] mt-2 w-64 rounded-3xl border border-[color:var(--border-soft)] bg-white p-2 shadow-[0_18px_42px_rgba(16,17,20,0.16)]">
              <div className="px-3 py-3 border-b border-[color:var(--border-soft)]">
                <p className="text-[13px] font-semibold text-[color:var(--text-primary)]">{user.name}</p>
                <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{user.email}</p>
              </div>
              {onBackToTools && (
                <button type="button" onClick={onBackToTools} className="btn-ghost mt-1 w-full justify-start px-3 text-[13px]">
                  <ArrowLeft className="h-4 w-4" />
                  工具选择
                </button>
              )}
              <button type="button" onClick={onLogout} className="btn-ghost w-full justify-start px-3 text-[13px]">
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
