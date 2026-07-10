import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  MoreHorizontal,
  Star,
  Pencil,
  FolderPlus,
  Trash2,
  Check,
} from 'lucide-react';
import { deleteDesign, fetchProjects, patchDesign, type Project } from '../../api/designsApi';
import { useToast } from '../Toast';
import './sidebar.css';

interface SidebarProps {
  user: { email: string; name: string; auth_token: string };
  onLogout: () => void;
}

interface RecentDesign {
  id: string;
  title: string;
  project_id: string | null;
  starred: boolean;
  updated_at: string;
}

type RecentMenuView = 'root' | 'rename' | 'projects' | 'delete';

export default function Sidebar({ user, onLogout }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [recents, setRecents] = useState<RecentDesign[]>([]);
  const [starredOpen, setStarredOpen] = useState(true);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [activeRecentMenuId, setActiveRecentMenuId] = useState<string | null>(null);
  const [recentMenuView, setRecentMenuView] = useState<RecentMenuView>('root');
  const [recentMenuPosition, setRecentMenuPosition] = useState({ left: 8, top: 8 });
  const [renameValue, setRenameValue] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [recentActionBusy, setRecentActionBusy] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const recentMenuRef = useRef<HTMLDivElement>(null);

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

  // Refresh recents when the AI auto-titles a design in the active chat
  useEffect(() => {
    const handler = () => void loadRecents();
    window.addEventListener('af:design-titled', handler);
    return () => window.removeEventListener('af:design-titled', handler);
  }, [loadRecents]);

  const closeRecentMenu = useCallback(() => {
    setActiveRecentMenuId(null);
    setRecentMenuView('root');
    setRecentActionBusy(false);
  }, []);

  useEffect(() => {
    if (!activeRecentMenuId) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (recentMenuRef.current?.contains(target) || target.closest('[data-recent-menu-trigger]')) {
        return;
      }
      closeRecentMenu();
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', closeRecentMenu);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', closeRecentMenu);
    };
  }, [activeRecentMenuId, closeRecentMenu]);

  useEffect(() => {
    closeRecentMenu();
  }, [location.pathname, closeRecentMenu]);

  const isRecentActive = useCallback((design: RecentDesign) => (
    location.pathname === `/chat/${design.id}` || location.pathname.endsWith(`/chat/${design.id}`)
  ), [location.pathname]);

  const navigateToRecent = useCallback((design: RecentDesign) => {
    navigate(
      design.project_id
        ? `/projects/${design.project_id}/chat/${design.id}`
        : `/chat/${design.id}`,
    );
  }, [navigate]);

  const openRecentMenu = (design: RecentDesign, button: HTMLButtonElement) => {
    if (activeRecentMenuId === design.id) {
      closeRecentMenu();
      return;
    }
    const rect = button.getBoundingClientRect();
    const menuWidth = 208;
    const estimatedHeight = 188;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    const belowTop = rect.bottom + 5;
    const top = belowTop + estimatedHeight <= window.innerHeight - 8
      ? belowTop
      : Math.max(8, rect.top - estimatedHeight - 5);
    setRecentMenuPosition({ left, top });
    setRenameValue(design.title || '无标题设计');
    setRecentMenuView('root');
    setActiveRecentMenuId(design.id);
  };

  const handleToggleStar = async (design: RecentDesign) => {
    const intendedStarred = !design.starred;
    setRecentActionBusy(true);
    try {
      const updated = await patchDesign(user.auth_token, design.id, { starred: intendedStarred });
      // Force intendedStarred into local state — don't rely on server echo for this flag.
      setRecents(current => current.map(item =>
        item.id === design.id ? { ...item, ...updated, starred: intendedStarred } : item,
      ));
      toast(intendedStarred ? '已收藏' : '已取消收藏', 'success');
      closeRecentMenu();
    } catch (error) {
      toast(error instanceof Error ? error.message : '操作失败', 'error');
      setRecentActionBusy(false);
    }
  };

  const handleRename = async (design: RecentDesign) => {
    const title = renameValue.trim();
    if (!title) {
      toast('设计名称不能为空', 'warning');
      return;
    }
    if (title === design.title) {
      closeRecentMenu();
      return;
    }
    setRecentActionBusy(true);
    try {
      const updated = await patchDesign(user.auth_token, design.id, { title });
      setRecents(current => current.map(item => item.id === design.id ? { ...item, ...updated } : item));
      toast('设计已重命名', 'success');
      closeRecentMenu();
    } catch (error) {
      toast(error instanceof Error ? error.message : '重命名失败', 'error');
      setRecentActionBusy(false);
    }
  };

  const openProjectPicker = async () => {
    setRecentMenuView('projects');
    setProjectsLoading(true);
    try {
      setProjects(await fetchProjects(user.auth_token));
    } catch (error) {
      toast(error instanceof Error ? error.message : '项目加载失败', 'error');
    } finally {
      setProjectsLoading(false);
    }
  };

  const handleMoveToProject = async (design: RecentDesign, projectId: string | null) => {
    if (design.project_id === projectId) {
      closeRecentMenu();
      return;
    }
    setRecentActionBusy(true);
    try {
      const updated = await patchDesign(user.auth_token, design.id, { project_id: projectId });
      setRecents(current => current.map(item => item.id === design.id ? { ...item, ...updated } : item));
      const projectName = projects.find(project => project.id === projectId)?.name;
      toast(projectId ? `已加入项目「${projectName || '未命名项目'}」` : '已移出项目', 'success');
      if (isRecentActive(design)) {
        navigate(
          projectId ? `/projects/${projectId}/chat/${design.id}` : `/chat/${design.id}`,
          { replace: true },
        );
      }
      closeRecentMenu();
    } catch (error) {
      toast(error instanceof Error ? error.message : '移动失败', 'error');
      setRecentActionBusy(false);
    }
  };

  const handleDelete = async (design: RecentDesign) => {
    setRecentActionBusy(true);
    try {
      await deleteDesign(user.auth_token, design.id);
      setRecents(current => current.filter(item => item.id !== design.id));
      if (isRecentActive(design)) navigate('/designs', { replace: true });
      toast('设计已删除', 'success');
      closeRecentMenu();
    } catch (error) {
      toast(error instanceof Error ? error.message : '删除失败', 'error');
      setRecentActionBusy(false);
    }
  };

  const activeRecent = recents.find(design => design.id === activeRecentMenuId) || null;
  const starredDesigns = recents.filter(d => d.starred);
  const recentDesigns = recents.filter(d => !d.starred);

  // Shared row renderer used in both sections
  const renderDesignRow = (d: RecentDesign) => {
    const active = isRecentActive(d);
    const menuOpen = activeRecentMenuId === d.id;
    return (
      <div
        key={d.id}
        className={`sidebar-recent-row ${active ? 'active' : ''} ${menuOpen ? 'menu-open' : ''}`}
      >
        <button
          type="button"
          className="sidebar-recent-item"
          onClick={() => navigateToRecent(d)}
          title={d.title || '无标题设计'}
        >
          <span className="sidebar-recent-title">{d.title || '无标题设计'}</span>
        </button>
        <button
          type="button"
          className="sidebar-recent-more"
          data-recent-menu-trigger
          aria-label={`打开 ${d.title || '无标题设计'} 的操作菜单`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={event => {
            event.stopPropagation();
            openRecentMenu(d, event.currentTarget);
          }}
        >
          <MoreHorizontal size={15} strokeWidth={1.8} />
        </button>
      </div>
    );
  };

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

      {/* Starred designs — shown above recents, like claude.ai */}
      {starredDesigns.length > 0 && (
        <div className="sidebar-section sidebar-recents">
          <button
            type="button"
            className="sidebar-section-toggle"
            onClick={() => setStarredOpen(v => !v)}
          >
            <Star className="w-3 h-3" strokeWidth={1.5} />
            <span className="sidebar-section-label" style={{ marginBottom: 0 }}>收藏</span>
            {starredOpen
              ? <ChevronDown className="w-3 h-3 ml-auto" strokeWidth={1.5} />
              : <ChevronRight className="w-3 h-3 ml-auto" strokeWidth={1.5} />
            }
          </button>
          {starredOpen && (
            <div className="sidebar-recents-list">
              {starredDesigns.map(renderDesignRow)}
            </div>
          )}
        </div>
      )}

      {/* Recent (non-starred) */}
      {recentDesigns.length > 0 && (
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
              {recentDesigns.map(renderDesignRow)}
            </div>
          )}
        </div>
      )}

      {activeRecent && createPortal(
        <div
          ref={recentMenuRef}
          className="sidebar-recent-menu"
          role="menu"
          aria-label={`${activeRecent.title || '无标题设计'} 的操作`}
          style={{ left: recentMenuPosition.left, top: recentMenuPosition.top }}
        >
          {recentMenuView === 'root' && (
            <>
              <button
                type="button"
                className="sidebar-recent-menu-item"
                role="menuitem"
                disabled={recentActionBusy}
                onClick={() => void handleToggleStar(activeRecent)}
              >
                <Star size={15} strokeWidth={1.6} fill={activeRecent.starred ? 'currentColor' : 'none'} />
                <span>{activeRecent.starred ? '取消收藏' : '收藏'}</span>
              </button>
              <button
                type="button"
                className="sidebar-recent-menu-item"
                role="menuitem"
                onClick={() => setRecentMenuView('rename')}
              >
                <Pencil size={15} strokeWidth={1.6} />
                <span>重命名</span>
              </button>
              <button
                type="button"
                className="sidebar-recent-menu-item"
                role="menuitem"
                onClick={() => void openProjectPicker()}
              >
                <FolderPlus size={15} strokeWidth={1.6} />
                <span>加入项目</span>
                <ChevronRight className="sidebar-recent-menu-chevron" size={14} strokeWidth={1.7} />
              </button>
              <div className="sidebar-recent-menu-separator" />
              <button
                type="button"
                className="sidebar-recent-menu-item sidebar-recent-menu-item--danger"
                role="menuitem"
                onClick={() => setRecentMenuView('delete')}
              >
                <Trash2 size={15} strokeWidth={1.6} />
                <span>删除</span>
              </button>
            </>
          )}

          {recentMenuView === 'rename' && (
            <div className="sidebar-recent-menu-panel">
              <div className="sidebar-recent-menu-heading">
                <button type="button" className="sidebar-recent-menu-back" onClick={() => setRecentMenuView('root')} aria-label="返回">
                  <ChevronRight size={14} strokeWidth={1.8} />
                </button>
                <span>重命名</span>
              </div>
              <input
                autoFocus
                className="sidebar-recent-rename-input"
                value={renameValue}
                onChange={event => setRenameValue(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') void handleRename(activeRecent);
                  if (event.key === 'Escape') setRecentMenuView('root');
                }}
                maxLength={120}
                aria-label="新的设计名称"
              />
              <div className="sidebar-recent-menu-actions">
                <button type="button" onClick={() => setRecentMenuView('root')} disabled={recentActionBusy}>取消</button>
                <button type="button" className="primary" onClick={() => void handleRename(activeRecent)} disabled={recentActionBusy || !renameValue.trim()}>
                  {recentActionBusy ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}

          {recentMenuView === 'projects' && (
            <div className="sidebar-recent-menu-panel">
              <div className="sidebar-recent-menu-heading">
                <button type="button" className="sidebar-recent-menu-back" onClick={() => setRecentMenuView('root')} aria-label="返回">
                  <ChevronRight size={14} strokeWidth={1.8} />
                </button>
                <span>加入项目</span>
              </div>
              <div className="sidebar-recent-project-list">
                {activeRecent.project_id && (
                  <button
                    type="button"
                    className="sidebar-recent-project-item"
                    disabled={recentActionBusy}
                    onClick={() => void handleMoveToProject(activeRecent, null)}
                  >
                    <span>移出当前项目</span>
                  </button>
                )}
                {projectsLoading ? (
                  <p className="sidebar-recent-menu-status">正在加载项目…</p>
                ) : projects.length === 0 ? (
                  <p className="sidebar-recent-menu-status">还没有可加入的项目</p>
                ) : projects.map(project => (
                  <button
                    key={project.id}
                    type="button"
                    className="sidebar-recent-project-item"
                    disabled={recentActionBusy}
                    onClick={() => void handleMoveToProject(activeRecent, project.id)}
                  >
                    <span>{project.name}</span>
                    {activeRecent.project_id === project.id && <Check size={13} strokeWidth={2} />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {recentMenuView === 'delete' && (
            <div className="sidebar-recent-menu-panel">
              <div className="sidebar-recent-delete-title">删除这个设计？</div>
              <p className="sidebar-recent-delete-copy">对话内容也会被删除，此操作无法撤销。</p>
              <div className="sidebar-recent-menu-actions">
                <button type="button" onClick={() => setRecentMenuView('root')} disabled={recentActionBusy}>取消</button>
                <button type="button" className="danger" onClick={() => void handleDelete(activeRecent)} disabled={recentActionBusy}>
                  {recentActionBusy ? '删除中…' : '删除'}
                </button>
              </div>
            </div>
          )}
        </div>,
        document.body,
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
