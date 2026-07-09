import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Plus,
  FolderOpen,
  Layers,
  Shirt,
  TrendingUp,
  BookMarked,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  LogOut,
  Clock,
} from 'lucide-react';
import './sidebar.css';

interface SidebarProps {
  user: { email: string; name: string; auth_token: string };
  onLogout: () => void;
}

interface RecentDesign {
  id: string;
  title: string;
  project_id: string | null;
  updated_at: string;
}

export default function Sidebar({ user, onLogout }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [recents, setRecents] = useState<RecentDesign[]>([]);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const initials = (user.name || user.email)[0]?.toUpperCase() || 'U';

  // Close user menu when clicking outside
  useEffect(() => {
    if (!userMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [userMenuOpen]);

  const loadRecents = useCallback(async () => {
    try {
      const res = await fetch('/api/design/designs/recents?limit=8', {
        headers: { Authorization: `Bearer ${user.auth_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setRecents(data.designs || []);
    } catch {
      // silent
    }
  }, [user.auth_token]);

  useEffect(() => {
    void loadRecents();
  }, [loadRecents, location.pathname]);

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="sidebar-brand">
        <span className="sidebar-brand-glyph">A·F</span>
        <span className="sidebar-brand-text">时尚 AI</span>
      </div>

      {/* New Design CTA */}
      <button
        type="button"
        className="sidebar-new-btn"
        onClick={() => navigate('/chat/new')}
      >
        <Plus className="w-4 h-4" strokeWidth={1.5} />
        新建设计
      </button>

      {/* Main nav */}
      <nav className="sidebar-nav" aria-label="主导航">
        <NavLink to="/designs" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
          <Layers className="w-4 h-4" strokeWidth={1.5} />
          我的设计
        </NavLink>
        <NavLink to="/projects" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
          <FolderOpen className="w-4 h-4" strokeWidth={1.5} />
          项目
        </NavLink>
      </nav>

      {/* Tools */}
      <div className="sidebar-section">
        <p className="sidebar-section-label">工具</p>
        <NavLink to="/try-on" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
          <Shirt className="w-4 h-4" strokeWidth={1.5} />
          虚拟试衣
        </NavLink>
        <NavLink to="/wardrobe" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
          <BookMarked className="w-4 h-4" strokeWidth={1.5} />
          衣橱
        </NavLink>
        <NavLink to="/trends" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
          <TrendingUp className="w-4 h-4" strokeWidth={1.5} />
          趋势分析
        </NavLink>
      </div>

      {/* Settings */}
      <div className="sidebar-section">
        <p className="sidebar-section-label">设置</p>
        <NavLink to="/customize" className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}>
          <SlidersHorizontal className="w-4 h-4" strokeWidth={1.5} />
          个性化
        </NavLink>
      </div>

      {/* Recents */}
      {recents.length > 0 && (
        <div className="sidebar-section sidebar-recents">
          <button
            type="button"
            className="sidebar-section-toggle"
            onClick={() => setRecentsOpen(v => !v)}
          >
            <Clock className="w-3 h-3" strokeWidth={1.5} />
            <span className="sidebar-section-label" style={{ marginBottom: 0 }}>最近</span>
            {recentsOpen
              ? <ChevronDown className="w-3 h-3 ml-auto" strokeWidth={1.5} />
              : <ChevronRight className="w-3 h-3 ml-auto" strokeWidth={1.5} />
            }
          </button>
          {recentsOpen && (
            <div className="sidebar-recents-list">
              {recents.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={`sidebar-recent-item ${
                    location.pathname === `/chat/${d.id}` ||
                    (d.project_id && location.pathname.includes(`/chat/${d.id}`))
                      ? 'active' : ''
                  }`}
                  onClick={() =>
                    d.project_id
                      ? navigate(`/projects/${d.project_id}/chat/${d.id}`)
                      : navigate(`/chat/${d.id}`)
                  }
                  title={d.title || '无标题设计'}
                >
                  {d.title || '无标题设计'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* User area */}
      <div className="sidebar-user" ref={userMenuRef} onClick={() => setUserMenuOpen(v => !v)}>
        <span className="sidebar-user-avatar">{initials}</span>
        <span className="sidebar-user-name">{user.name}</span>
        <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} strokeWidth={1.5} />
        {userMenuOpen && (
          <div className="sidebar-user-menu">
            <div className="sidebar-user-menu-info">
              <p className="sidebar-user-menu-name">{user.name}</p>
              <p className="sidebar-user-menu-email">{user.email}</p>
            </div>
            <button
              type="button"
              className="sidebar-user-menu-btn"
              onClick={() => { setUserMenuOpen(false); navigate('/customize'); }}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" strokeWidth={1.5} />
              个性化设置
            </button>
            <button
              type="button"
              className="sidebar-user-menu-btn sidebar-user-menu-btn--danger"
              onClick={onLogout}
            >
              <LogOut className="w-3.5 h-3.5" strokeWidth={1.5} />
              退出登录
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
