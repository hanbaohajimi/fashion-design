import { useState, useCallback, useRef, useEffect, Suspense, lazy, type ReactNode } from 'react';
import { Plus, ChevronDown, X, SlidersHorizontal, LogOut, Sparkles, Wand2, Shirt, LayoutGrid } from 'lucide-react';
import ErrorBoundary from '../components/ErrorBoundary';
import type { Trend } from '../types/profile';

const DesignStudioWorkspace = lazy(() => import('../modules/design-studio/DesignStudioWorkspace'));
const TryOnWorkspace = lazy(() => import('../modules/tryon/TryOnWorkspace'));
const WardrobeWorkspace = lazy(() => import('../modules/wardrobe/WardrobeWorkspace'));
const TrendsHubWorkspace = lazy(() => import('../modules/trends-hub/TrendsHubWorkspace'));
const SettingsPanel = lazy(() => import('../modules/design-studio/components/SettingsPanel'));

type WorkspaceType = 'design-studio' | 'tryon' | 'wardrobe' | 'trends-hub';
const KNOWN_TYPES: ReadonlySet<WorkspaceType> = new Set<WorkspaceType>([
  'design-studio',
  'tryon',
  'wardrobe',
  'trends-hub',
]);

interface WorkspaceTab {
  id: string;
  type: WorkspaceType;
  title: string;
}

interface MainAppProps {
  user: { email: string; name: string; auth_token: string };
  onLogout: () => void;
}

interface PresetMeta {
  numeral: string;
  title: string;
  italicTitle: string;
  desc: string;
  icon: ReactNode;
}

const PRESETS: Record<WorkspaceType, PresetMeta> = {
  'design-studio': {
    numeral: '01',
    title: 'Design Studio',
    italicTitle: 'L\u2019Atelier',
    desc: '对话生图 · 画布编辑 · 设计探索',
    icon: <Sparkles className="h-4 w-4" strokeWidth={1.5} />,
  },
  tryon: {
    numeral: '02',
    title: 'Try-On',
    italicTitle: 'La Pose',
    desc: '穿搭 · 模特 · 背景 · 动作 · 美颜',
    icon: <Wand2 className="h-4 w-4" strokeWidth={1.5} />,
  },
  wardrobe: {
    numeral: '03',
    title: 'Wardrobe',
    italicTitle: 'La Garde-Robe',
    desc: '衣物收纳 · AI 分类 · 穿搭方案',
    icon: <Shirt className="h-4 w-4" strokeWidth={1.5} />,
  },
  'trends-hub': {
    numeral: '04',
    title: 'Trends',
    italicTitle: 'L\u2019Air du Temps',
    desc: '趋势探索 · 趋势分析 · 灵感来源',
    icon: <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />,
  },
};

const PRESET_LABEL_ZH: Record<WorkspaceType, string> = {
  'design-studio': '画布工作台',
  tryon: '试衣台',
  wardrobe: '我的衣橱',
  'trends-hub': '时尚趋势',
};

let _c = 0;
const nid = () => `ws-${++_c}`;

function WorkspaceFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center" style={{ background: 'var(--color-canvas)' }}>
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          padding: '20px 28px',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <p className="kicker">Loading workspace</p>
        <p className="headline headline-sm" style={{ marginTop: 8 }}>{label}</p>
      </div>
    </div>
  );
}

export default function MainApp({ user, onLogout }: MainAppProps) {
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => [
    { id: nid(), type: 'design-studio', title: PRESET_LABEL_ZH['design-studio'] },
    { id: nid(), type: 'tryon', title: PRESET_LABEL_ZH.tryon },
    { id: nid(), type: 'wardrobe', title: PRESET_LABEL_ZH.wardrobe },
    { id: nid(), type: 'trends-hub', title: PRESET_LABEL_ZH['trends-hub'] },
  ]);
  const [activeId, setActiveId] = useState(tabs[0].id);
  const [showMenu, setShowMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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
    const t: WorkspaceTab = { id: nid(), type, title: PRESET_LABEL_ZH[type] };
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
      <header className="topbar editorial-topbar">
        <div className="brand-mark">
          <span className="brand-glyph">A&middot;F</span>
          <span className="brand-meta">
            <span className="kicker" style={{ fontSize: 9, letterSpacing: '0.28em' }}>AI Fashion</span>
            <span className="brand-issue">Atelier &middot; Vol. I</span>
          </span>
        </div>

        <span className="topbar-divider" aria-hidden />

        <nav className="tab-rail" aria-label="Workspace tabs">
          {tabs.map(tab => {
            const preset = PRESETS[tab.type];
            const active = tab.id === activeId;
            const isCustom = tab.title !== PRESET_LABEL_ZH[tab.type];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveId(tab.id)}
                className={`tab-editorial ${active ? 'active' : ''}`}
                title={tab.title}
              >
                <span className="tab-numeral">{preset.numeral}</span>
                <span className="tab-label">
                  {isCustom ? tab.title : preset.title}
                </span>
                {tabs.length > 1 && (
                  <span
                    className="tab-close"
                    role="button"
                    tabIndex={-1}
                    aria-label="Close tab"
                    onClick={e => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    <X className="h-3 w-3" strokeWidth={1.5} />
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="topbar-actions">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setShowMenu(v => !v)}
              className="icon-btn-editorial"
              title="新建工作区"
              aria-label="新建工作区"
            >
              <Plus className="h-4 w-4" strokeWidth={1.5} />
            </button>
            {showMenu && (
              <div className="dropdown-enter editorial-dropdown" style={{ width: 320 }}>
                <div style={{ padding: '14px 18px 12px' }}>
                  <p className="kicker">New Workspace</p>
                  <p className="headline headline-sm" style={{ marginTop: 4 }}>选择一个新入口</p>
                </div>
                <hr className="rule-thin" />
                {(Object.entries(PRESETS) as [WorkspaceType, PresetMeta][]).map(([type, preset]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addTab(type)}
                    className="editorial-menu-row"
                  >
                    <span className="editorial-menu-numeral">{preset.numeral}</span>
                    <span className="editorial-menu-body">
                      <span className="editorial-menu-title">
                        {preset.title}{' '}
                        <em>/ {preset.italicTitle}</em>
                      </span>
                      <span className="editorial-menu-desc">{preset.desc}</span>
                    </span>
                    <span className="editorial-menu-icon">{preset.icon}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setShowUserMenu(v => !v)}
              className="user-chip"
              title={user.name}
            >
              <span className="user-avatar">{initials}</span>
              <span className="user-meta">
                <span className="kicker" style={{ fontSize: 9, letterSpacing: '0.28em' }}>Account</span>
                <span className="user-name">{user.name}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} style={{ color: 'var(--color-ink-3)' }} />
            </button>
            {showUserMenu && (
              <div className="dropdown-enter editorial-dropdown" style={{ width: 260 }}>
                <div style={{ padding: '16px 18px' }}>
                  <p className="kicker">Signed in as</p>
                  <p className="headline headline-sm" style={{ marginTop: 4 }}>{user.name}</p>
                  <p className="dek" style={{ marginTop: 4, fontSize: 12, color: 'var(--color-ink-3)' }}>{user.email}</p>
                </div>
                <hr className="rule-thin" />
                <button
                  type="button"
                  onClick={() => { setShowUserMenu(false); setShowSettings(true); }}
                  className="editorial-menu-row compact"
                >
                  <SlidersHorizontal className="h-4 w-4" strokeWidth={1.5} style={{ color: 'var(--color-ink-2)' }} />
                  <span className="editorial-menu-title sans" style={{ fontSize: 13, fontFamily: 'var(--font-ui)', fontWeight: 'var(--weight-regular)', letterSpacing: '0.02em' }}>个性化档案</span>
                </button>
                <button
                  type="button"
                  onClick={onLogout}
                  className="editorial-menu-row compact"
                >
                  <LogOut className="h-4 w-4" strokeWidth={1.5} style={{ color: 'var(--color-ink-2)' }} />
                  <span className="editorial-menu-title sans" style={{ fontSize: 13, fontFamily: 'var(--font-ui)', fontWeight: 'var(--weight-regular)', letterSpacing: '0.02em' }}>退出登录</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel
            authToken={user.auth_token}
            onClose={() => setShowSettings(false)}
            onEditProject={() => setShowSettings(false)}
          />
        </Suspense>
      )}

      <div className="flex-1 relative min-h-0">
        {tabs.map(tab => {
          if (!KNOWN_TYPES.has(tab.type)) return null;
          return (
            <div key={tab.id} className={`absolute inset-0 ${activeId === tab.id ? 'z-10 workspace-enter' : 'z-0 invisible'}`}>
              {mounted.has(tab.id) && (
                <ErrorBoundary fallbackLabel={tab.title}>
                  <Suspense fallback={<WorkspaceFallback label={tab.title} />}>
                    {tab.type === 'design-studio' && <DesignStudioWorkspace user={user} initialTrend={pendingTrend.get(tab.id)} />}
                    {tab.type === 'tryon' && <TryOnWorkspace user={user} />}
                    {tab.type === 'wardrobe' && <WardrobeWorkspace user={user} />}
                    {tab.type === 'trends-hub' && (
                      <TrendsHubWorkspace user={user} onDesignThis={trend => addDesignTabWithTrend(trend)} />
                    )}
                  </Suspense>
                </ErrorBoundary>
              )}
            </div>
          );
        })}
        {!activeTab && (
          <div className="flex h-full items-center justify-center" style={{ color: 'var(--color-ink-3)' }}>
            没有可用工作区
          </div>
        )}
      </div>
    </div>
  );
}
